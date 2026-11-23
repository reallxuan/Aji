//! The persistent analysis cache (P2 M2 design 5.2): one SQLite file, owned by a dedicated
//! thread that the engine actor talks to through a channel. Writes are batched; when the file
//! cannot be used, the same store runs on an in-memory database and says why.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aji_core::PositionKey;
use rusqlite::{Connection, ErrorCode, OptionalExtension, params};
use tokio::sync::oneshot;

use crate::{AnalysisUpdate, EngineIdentity, TrendStats};

/// Pending writes are committed at least this often.
const COMMIT_EVERY: Duration = Duration::from_millis(250);
/// Counted per row on top of its data, for the size cap.
const ROW_OVERHEAD: u64 = 64;

/// One stored analysis.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub update: AnalysisUpdate,
    /// Read from a LizzieYzy file rather than searched by this engine (design 5.11).
    pub imported: bool,
    pub katago_version: String,
}

/// What `replaces` compares: root visits, final, imported.
type Rank = (u32, bool, bool);

fn rank(row: &Row) -> Rank {
    (row.update.root_visits, row.update.is_final, row.imported)
}

fn outranks(old: Rank, new: Rank) -> bool {
    let ((ov, of, oi), (nv, nf, ni)) = (old, new);
    match (oi, ni) {
        (false, true) => false,
        (true, false) => nv > ov || nf,
        _ => nv > ov || (nv == ov && nf && !of),
    }
}

/// Whether `new` should replace `old` (design 5.2):
/// - more root visits wins, or equal visits when only the new one is final;
/// - an imported row gives way to a fresh row with more visits, or a final one;
/// - a fresh row never gives way to an imported one.
pub fn replaces(old: &Row, new: &Row) -> bool {
    outranks(rank(old), rank(new))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClearScope {
    Keys(Vec<PositionKey>),
    All,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheStats {
    pub used_bytes: u64,
    pub cap_bytes: u64,
    pub persistent: bool,
    /// Why the file is not used, when it is not.
    pub reason: Option<String>,
}

type Reply = Box<dyn FnOnce(Option<Row>) + Send>;

enum Cmd {
    Get(EngineIdentity, PositionKey, Reply),
    GetMany(
        EngineIdentity,
        Vec<PositionKey>,
        oneshot::Sender<Vec<Option<TrendStats>>>,
    ),
    Put(EngineIdentity, Box<Row>),
    Clear(EngineIdentity, ClearScope),
    SetCap(u64),
    Stats(oneshot::Sender<CacheStats>),
    Flush(oneshot::Sender<()>),
    /// Tests: the full scans so far, and a full count of the bytes.
    #[cfg(test)]
    Probe(oneshot::Sender<(u64, u64)>),
}

/// A handle to the store thread. Clones share the thread; it ends, after a last commit, when
/// every handle is dropped.
#[derive(Clone)]
pub struct Store {
    tx: Sender<Cmd>,
}

impl Store {
    /// Opens or creates the file. Never fails: on error it runs in memory, and `stats` says why.
    pub fn open(path: PathBuf, cap_bytes: u64) -> Store {
        Store::start(
            move || match open_file(&path) {
                Ok(conn) => (conn, None),
                Err(reason) => (memory(), Some(reason)),
            },
            cap_bytes,
        )
    }

    /// An in-memory store, as when the file cannot be used, with `reason`.
    pub fn in_memory(cap_bytes: u64, reason: Option<String>) -> Store {
        Store::start(
            move || (memory(), Some(reason.unwrap_or_default())),
            cap_bytes,
        )
    }

    fn start(
        open: impl FnOnce() -> (Connection, Option<String>) + Send + 'static,
        cap_bytes: u64,
    ) -> Store {
        let (tx, rx) = mpsc::channel();
        thread::Builder::new()
            .name("aji-store".into())
            .spawn(move || {
                let (conn, reason) = open();
                let mut db = Db::new(conn, reason, cap_bytes);
                loop {
                    let wait = db.dirty_since.map_or(Duration::from_secs(3600), |t| {
                        COMMIT_EVERY.saturating_sub(t.elapsed())
                    });
                    match rx.recv_timeout(wait) {
                        Ok(cmd) => db.handle(cmd),
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => {
                            db.commit();
                            return;
                        }
                    }
                    if db.dirty_since.is_some_and(|t| t.elapsed() >= COMMIT_EVERY) {
                        db.commit();
                    }
                }
            })
            .expect("spawn the store thread");
        Store { tx }
    }

    fn send(&self, cmd: Cmd) {
        // The thread only ends when every handle is gone, so this cannot fail while `self` lives.
        let _ = self.tx.send(cmd);
    }

    /// The row for `key`; counts as a use. `reply` runs on the store thread.
    pub fn get(
        &self,
        id: &EngineIdentity,
        key: PositionKey,
        reply: impl FnOnce(Option<Row>) + Send + 'static,
    ) {
        self.send(Cmd::Get(*id, key, Box::new(reply)));
    }

    /// The root stats of each key, in order, without counting as uses.
    pub fn get_many(
        &self,
        id: &EngineIdentity,
        keys: Vec<PositionKey>,
    ) -> oneshot::Receiver<Vec<Option<TrendStats>>> {
        let (tx, rx) = oneshot::channel();
        self.send(Cmd::GetMany(*id, keys, tx));
        rx
    }

    /// Stores `row` if it replaces what is there. Batched; committed within 250 ms.
    pub fn put(&self, id: &EngineIdentity, row: Row) {
        self.send(Cmd::Put(*id, Box::new(row)));
    }

    /// Removes rows: `Keys` for this identity, `All` for every identity.
    pub fn clear(&self, id: &EngineIdentity, scope: ClearScope) {
        self.send(Cmd::Clear(*id, scope));
    }

    /// A new size cap; a lower one evicts at once, keeping rows not yet committed.
    pub fn set_cap(&self, bytes: u64) {
        self.send(Cmd::SetCap(bytes));
    }

    pub fn stats(&self) -> oneshot::Receiver<CacheStats> {
        let (tx, rx) = oneshot::channel();
        self.send(Cmd::Stats(tx));
        rx
    }

    /// Commits pending writes; resolves once they are in the file.
    pub fn flush(&self) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        self.send(Cmd::Flush(tx));
        rx
    }
}

fn is_corrupt(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt)
    )
}

fn connect(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    // Freed pages go back to the file system when rows are deleted (final review #3). A file
    // made before this setting is converted once; that is best effort, since another copy of
    // Aji may hold the file, and the store works either way.
    let vacuum: i64 = conn.query_row("PRAGMA auto_vacuum", [], |r| r.get(0))?;
    if vacuum != INCREMENTAL {
        let _ = conn.execute_batch("PRAGMA auto_vacuum = INCREMENTAL; VACUUM;");
    }
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
            Some(check),
        ));
    }
    schema(&conn)?;
    Ok(conn)
}

/// Connects, retrying while another connection holds the file: switching a new file to WAL
/// reports it locked at once, without the busy timeout, when two copies open it together.
fn connect_retrying(path: &Path) -> rusqlite::Result<Connection> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match connect(path) {
            Err(e)
                if matches!(
                    e.sqlite_error_code(),
                    Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
                ) && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(20));
            }
            other => return other,
        }
    }
}

/// Opens the file; a corrupt one is renamed aside and replaced (design 5.2).
fn open_file(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    match connect_retrying(path) {
        Ok(conn) => Ok(conn),
        Err(e) if is_corrupt(&e) => {
            let secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            let stem = path
                .file_stem()
                .map_or("analysis".into(), |s| s.to_string_lossy());
            let aside = path.with_file_name(format!("{stem}.corrupt-{secs}.sqlite"));
            std::fs::rename(path, &aside).map_err(|e| e.to_string())?;
            for suffix in ["-wal", "-shm"] {
                let mut side = path.as_os_str().to_owned();
                side.push(suffix);
                let _ = std::fs::remove_file(PathBuf::from(side));
            }
            connect(path).map_err(|e| e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

fn memory() -> Connection {
    let conn = Connection::open_in_memory().expect("an in-memory database");
    schema(&conn).expect("the schema on an in-memory database");
    conn
}

fn schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS analysis (
            network BLOB NOT NULL,
            config INTEGER NOT NULL,
            key INTEGER NOT NULL,
            visits INTEGER NOT NULL,
            is_final INTEGER NOT NULL,
            imported INTEGER NOT NULL,
            winrate REAL NOT NULL,
            score_lead REAL NOT NULL,
            katago_version TEXT NOT NULL,
            used INTEGER NOT NULL,
            bytes INTEGER NOT NULL,
            data TEXT NOT NULL,
            ownership BLOB,
            PRIMARY KEY (network, config, key)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS analysis_used ON analysis (used);",
    )
}

type Slot = (EngineIdentity, PositionKey);

/// SQLite's `auto_vacuum` value for incremental vacuuming.
const INCREMENTAL: i64 = 2;

struct Db {
    conn: Connection,
    reason: Option<String>,
    cap: u64,
    /// The logical clock of uses.
    clock: i64,
    /// The first clock value of the batch not yet committed: eviction keeps everything newer.
    batch_start: i64,
    pending: HashMap<Slot, (Row, i64)>,
    touches: HashMap<Slot, i64>,
    dirty_since: Option<Instant>,
    /// The table's bytes, kept as rows are written and recounted after deletes.
    used: u64,
    /// Full counts of the table's bytes so far.
    scans: u64,
}

impl Db {
    fn new(conn: Connection, reason: Option<String>, cap: u64) -> Db {
        let clock = conn
            .query_row("SELECT COALESCE(MAX(used), 0) FROM analysis", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);
        let mut db = Db {
            conn,
            reason,
            cap,
            clock,
            batch_start: clock + 1,
            pending: HashMap::new(),
            touches: HashMap::new(),
            dirty_since: None,
            used: 0,
            scans: 0,
        };
        db.used = db.count_bytes();
        db
    }

    fn tick(&mut self) -> i64 {
        self.clock += 1;
        self.dirty_since.get_or_insert_with(Instant::now);
        self.clock
    }

    fn handle(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Get(id, key, reply) => {
                let row = self.read(&id, key);
                if row.is_some() {
                    let used = self.tick();
                    match self.pending.get_mut(&(id, key)) {
                        Some(entry) => entry.1 = used,
                        None => {
                            self.touches.insert((id, key), used);
                        }
                    }
                }
                reply(row);
            }
            Cmd::GetMany(id, keys, reply) => {
                let stats = keys
                    .into_iter()
                    .map(|key| self.stats_of(&id, key))
                    .collect();
                let _ = reply.send(stats);
            }
            Cmd::Put(id, row) => {
                let better = match self.pending.get(&(id, row.update.position)) {
                    Some((old, _)) => replaces(old, &row),
                    None => self
                        .stored_rank(&id, row.update.position)
                        .is_none_or(|old| outranks(old, rank(&row))),
                };
                if better {
                    let used = self.tick();
                    self.touches.remove(&(id, row.update.position));
                    self.pending.insert((id, row.update.position), (*row, used));
                }
            }
            Cmd::Clear(id, scope) => {
                self.commit();
                let done = match scope {
                    ClearScope::All => self.conn.execute("DELETE FROM analysis", []).map(drop),
                    ClearScope::Keys(keys) => keys.iter().try_for_each(|key| {
                        self.conn
                            .execute(
                                "DELETE FROM analysis WHERE network = ?1 AND config = ?2 AND key = ?3",
                                params![&id.network[..], id.config as i64, key.0 as i64],
                            )
                            .map(drop)
                    }),
                };
                if let Err(e) = done {
                    self.fall_back(e.to_string());
                }
                self.used = self.count_bytes();
                self.shrink();
            }
            Cmd::SetCap(bytes) => {
                // Rows from the batch not yet committed are kept, even below the cap (design
                // 5.2; Review Focus 5): eviction stops at the batch's first use.
                self.cap = bytes;
                let keep_from = self.batch_start;
                self.commit();
                self.evict(keep_from);
            }
            Cmd::Stats(reply) => {
                self.commit();
                let _ = reply.send(CacheStats {
                    used_bytes: self.used,
                    cap_bytes: self.cap,
                    persistent: self.reason.is_none(),
                    reason: self.reason.clone(),
                });
            }
            Cmd::Flush(reply) => {
                self.commit();
                let _ = reply.send(());
            }
            #[cfg(test)]
            Cmd::Probe(reply) => {
                let scans = self.scans;
                let _ = reply.send((scans, self.count_bytes()));
            }
        }
    }

    fn read(&self, id: &EngineIdentity, key: PositionKey) -> Option<Row> {
        if let Some((row, _)) = self.pending.get(&(*id, key)) {
            return Some(row.clone());
        }
        self.conn
            .query_row(
                "SELECT data, ownership, imported, katago_version FROM analysis
                 WHERE network = ?1 AND config = ?2 AND key = ?3",
                params![&id.network[..], id.config as i64, key.0 as i64],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<Vec<u8>>>(1)?,
                        r.get::<_, bool>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .ok()
            .flatten()
            .and_then(|(data, ownership, imported, katago_version)| {
                let mut update: AnalysisUpdate = serde_json::from_str(&data).ok()?;
                update.ownership = ownership.map(|o| o.into_iter().map(|b| b as i8).collect());
                Some(Row {
                    update,
                    imported,
                    katago_version,
                })
            })
    }

    fn stats_of(&self, id: &EngineIdentity, key: PositionKey) -> Option<TrendStats> {
        if let Some((row, _)) = self.pending.get(&(*id, key)) {
            return Some(TrendStats::of(&row.update));
        }
        self.conn
            .query_row(
                "SELECT winrate, score_lead, visits FROM analysis
                 WHERE network = ?1 AND config = ?2 AND key = ?3",
                params![&id.network[..], id.config as i64, key.0 as i64],
                |r| {
                    Ok(TrendStats {
                        winrate: r.get(0)?,
                        score_lead: r.get(1)?,
                        visits: r.get(2)?,
                    })
                },
            )
            .optional()
            .ok()
            .flatten()
    }

    fn stored_rank(&self, id: &EngineIdentity, key: PositionKey) -> Option<Rank> {
        self.conn
            .query_row(
                "SELECT visits, is_final, imported FROM analysis
                 WHERE network = ?1 AND config = ?2 AND key = ?3",
                params![&id.network[..], id.config as i64, key.0 as i64],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .ok()
            .flatten()
    }

    /// Every row's bytes, summed: a full scan of the table.
    fn count_bytes(&mut self) -> u64 {
        self.scans += 1;
        self.conn
            .query_row("SELECT COALESCE(SUM(bytes), 0) FROM analysis", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_or(0, |b| b as u64)
    }

    /// Writes the batch, then evicts down to the cap, keeping the batch.
    fn commit(&mut self) {
        if self.pending.is_empty() && self.touches.is_empty() {
            self.dirty_since = None;
            return;
        }
        if let Err(e) = self.write() {
            self.fall_back(e.to_string());
            if let Err(e) = self.write() {
                // An in-memory database refusing a write leaves nothing to fall back to.
                self.reason = Some(e.to_string());
            }
            self.used = self.count_bytes();
        }
        let batch_start = self.batch_start;
        self.pending.clear();
        self.touches.clear();
        self.dirty_since = None;
        self.evict(batch_start);
        self.batch_start = self.clock + 1;
    }

    fn write(&mut self) -> rusqlite::Result<()> {
        let tx = self.conn.transaction()?;
        // Added to the running total once the batch is in the file.
        let mut grown: i64 = 0;
        for ((id, key), (row, used)) in &self.pending {
            let mut plain = row.update.clone();
            let ownership: Option<Vec<u8>> = plain
                .ownership
                .take()
                .map(|o| o.into_iter().map(|v| v as u8).collect());
            let data = serde_json::to_string(&plain).expect("an update serialises");
            let bytes =
                data.len() as u64 + ownership.as_ref().map_or(0, |o| o.len() as u64) + ROW_OVERHEAD;
            let replaced: i64 = tx
                .query_row(
                    "SELECT bytes FROM analysis WHERE network = ?1 AND config = ?2 AND key = ?3",
                    params![&id.network[..], id.config as i64, key.0 as i64],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(0);
            grown += bytes as i64 - replaced;
            tx.execute(
                "INSERT OR REPLACE INTO analysis (network, config, key, visits, is_final, imported,
                 winrate, score_lead, katago_version, used, bytes, data, ownership)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    &id.network[..],
                    id.config as i64,
                    key.0 as i64,
                    row.update.root_visits,
                    row.update.is_final,
                    row.imported,
                    row.update.winrate,
                    row.update.score_lead,
                    row.katago_version,
                    used,
                    bytes as i64,
                    data,
                    ownership,
                ],
            )?;
        }
        for ((id, key), used) in &self.touches {
            tx.execute(
                "UPDATE analysis SET used = ?4 WHERE network = ?1 AND config = ?2 AND key = ?3",
                params![&id.network[..], id.config as i64, key.0 as i64, used],
            )?;
        }
        tx.commit()?;
        self.used = self.used.saturating_add_signed(grown);
        Ok(())
    }

    /// Deletes the least recently used rows older than `keep_from`, a tenth of the rows at a
    /// time, until the total is under the cap or nothing older is left.
    fn evict(&mut self, keep_from: i64) {
        let mut evicted = false;
        while self.used > self.cap {
            let count: i64 = self
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM analysis WHERE used < ?1",
                    [keep_from],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if count == 0 {
                break;
            }
            let all: i64 = self
                .conn
                .query_row("SELECT COUNT(*) FROM analysis", [], |r| r.get(0))
                .unwrap_or(count);
            let batch = (all / 10).max(1);
            let deleted = self.conn.execute(
                "DELETE FROM analysis WHERE (network, config, key) IN
                 (SELECT network, config, key FROM analysis WHERE used < ?1 ORDER BY used LIMIT ?2)",
                params![keep_from, batch],
            );
            if !matches!(deleted, Ok(n) if n > 0) {
                break;
            }
            evicted = true;
            self.used = self.count_bytes();
        }
        if evicted {
            self.shrink();
        }
    }

    /// Hands freed pages back to the file system, and empties the write-ahead log into the
    /// file, so a clear or a lower cap shows on disk. Best effort: a reader in another copy of
    /// Aji can hold the log until it is done.
    fn shrink(&self) {
        // The pragma frees one page per step, so it is stepped to the end.
        let vacuum = || -> rusqlite::Result<()> {
            let mut stmt = self.conn.prepare("PRAGMA incremental_vacuum")?;
            let mut rows = stmt.query([])?;
            while rows.next()?.is_some() {}
            Ok(())
        };
        let _ = vacuum();
        let _ = self
            .conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    }

    /// The file stopped working (a full disk, say): carry on in memory and say why.
    fn fall_back(&mut self, reason: String) {
        if self.reason.is_none() {
            self.conn = memory();
            self.used = 0;
            self.reason = Some(reason);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::Candidate;
    use aji_core::{Move, Point};

    fn id(n: u8) -> EngineIdentity {
        EngineIdentity {
            network: [n; 32],
            config: 7,
        }
    }

    fn row(key: u64, visits: u32, is_final: bool, imported: bool) -> Row {
        Row {
            update: AnalysisUpdate {
                position: PositionKey(key),
                board_size: 19,
                root_visits: visits,
                winrate: 0.5,
                score_lead: 0.5,
                is_final,
                candidates: vec![Candidate {
                    mv: Move::Play(Point { x: 3, y: 3 }),
                    order: 0,
                    visits,
                    winrate: 0.5,
                    score_lead: 0.5,
                    prior: 0.2,
                    pv: vec![Move::Play(Point { x: 3, y: 3 })],
                }],
                previous_visits: 0,
                ownership: Some(vec![-127, 0, 127]),
            },
            imported,
            katago_version: "1.18.2".into(),
        }
    }

    fn get(store: &Store, id: &EngineIdentity, key: u64) -> Option<Row> {
        let (tx, rx) = std::sync::mpsc::channel();
        store.get(id, PositionKey(key), move |r| tx.send(r).unwrap());
        rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap()
    }

    fn flush(store: &Store) {
        store.flush().blocking_recv().unwrap();
    }

    fn stats(store: &Store) -> CacheStats {
        store.stats().blocking_recv().unwrap()
    }

    #[test]
    fn replaces_follows_the_design() {
        // (old visits, old final, old imported, new visits, new final, new imported, replaces)
        let cases = [
            (100, false, false, 50, false, false, false),
            (100, false, false, 100, false, false, false),
            (100, false, false, 100, true, false, true),
            (100, true, false, 100, true, false, false),
            (100, false, false, 101, false, false, true),
            // An imported row gives way to more visits or a finished search.
            (100, true, true, 50, false, false, false),
            (100, true, true, 100, false, false, false),
            (100, true, true, 101, false, false, true),
            (100, true, true, 50, true, false, true),
            // A fresh row never gives way to an imported one.
            (100, false, false, 5000, true, true, false),
            // Imported against imported: the usual rule.
            (100, false, true, 200, false, true, true),
            (100, false, true, 50, true, true, false),
        ];
        for (ov, of, oi, nv, nf, ni, want) in cases {
            let got = replaces(&row(1, ov, of, oi), &row(1, nv, nf, ni));
            assert_eq!(got, want, "old {ov} {of} {oi}, new {nv} {nf} {ni}");
        }
    }

    /// The file and its write-ahead log, in bytes.
    fn on_disk(path: &std::path::Path) -> u64 {
        let size = |p: std::path::PathBuf| std::fs::metadata(p).map_or(0, |m| m.len());
        let mut wal = path.as_os_str().to_owned();
        wal.push("-wal");
        size(path.to_path_buf()) + size(wal.into())
    }

    fn filled(path: &std::path::Path) -> Store {
        let store = Store::open(path.to_path_buf(), 1 << 30);
        for key in 0..3000 {
            store.put(&id(1), row(key, 500, true, false));
        }
        flush(&store);
        store
    }

    #[test]
    fn clearing_everything_gives_the_space_back() {
        // Final review #3: deleting rows must shrink the file, not only free pages inside it.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("analysis.sqlite");
        let store = filled(&path);
        let before = on_disk(&path);
        store.clear(&id(1), ClearScope::All);
        flush(&store);
        let after = on_disk(&path);
        assert!(after * 4 < before, "{before} bytes before, {after} after");
    }

    #[test]
    fn a_lower_cap_gives_the_space_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("analysis.sqlite");
        let store = filled(&path);
        let before = on_disk(&path);
        store.set_cap(stats(&store).used_bytes / 10);
        flush(&store);
        let after = on_disk(&path);
        assert!(after * 2 < before, "{before} bytes before, {after} after");
    }

    #[test]
    fn commits_keep_a_running_total_without_rescanning() {
        // Final review #6: summing every row on each commit costs a core at a full cache.
        let store = Store::in_memory(1 << 30, None);
        let (scans_at_start, _) = probe(&store);
        for key in 0..50 {
            store.put(&id(1), row(key, 100, false, false));
            flush(&store);
            // A better result replaces a row: its old size leaves the total.
            store.put(&id(1), row(key, 900, true, false));
            flush(&store);
        }
        store.clear(
            &id(1),
            ClearScope::Keys(vec![PositionKey(3), PositionKey(4)]),
        );
        let used = stats(&store).used_bytes;
        let (scans, sum) = probe(&store);
        assert_eq!(used, sum, "the running total matches a full count");
        assert!(
            scans - scans_at_start <= 2,
            "{} full scans",
            scans - scans_at_start
        );
    }

    fn probe(store: &Store) -> (u64, u64) {
        let (tx, rx) = oneshot::channel();
        store.send(Cmd::Probe(tx));
        rx.blocking_recv().unwrap()
    }

    #[test]
    fn a_reopened_file_keeps_its_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("analysis.sqlite");
        {
            let store = Store::open(path.clone(), 1 << 30);
            store.put(&id(1), row(10, 500, true, false));
            flush(&store);
            assert!(stats(&store).persistent);
        }
        let store = Store::open(path, 1 << 30);
        let back = get(&store, &id(1), 10).expect("kept");
        assert_eq!(back, row(10, 500, true, false));
        let many = store
            .get_many(&id(1), vec![PositionKey(10), PositionKey(11)])
            .blocking_recv()
            .unwrap();
        assert_eq!(many[0].map(|s| s.visits), Some(500));
        assert_eq!(many[1], None);
    }

    #[test]
    fn rows_are_per_identity() {
        let store = Store::in_memory(1 << 30, None);
        store.put(&id(1), row(10, 500, true, false));
        assert!(get(&store, &id(1), 10).is_some());
        assert!(get(&store, &id(2), 10).is_none());
    }

    #[test]
    fn a_worse_row_is_not_stored() {
        let store = Store::in_memory(1 << 30, None);
        store.put(&id(1), row(10, 500, true, false));
        store.put(&id(1), row(10, 100, false, false));
        assert_eq!(get(&store, &id(1), 10).unwrap().update.root_visits, 500);
    }

    #[test]
    fn the_cap_evicts_least_recently_used() {
        let store = Store::in_memory(1 << 30, None);
        for k in 0..20 {
            store.put(&id(1), row(k, 100, true, false));
            flush(&store);
        }
        // Row 0 is used again, so row 1 is now the oldest.
        assert!(get(&store, &id(1), 0).is_some());
        let full = stats(&store).used_bytes;
        store.set_cap(full * 3 / 4);
        flush(&store);
        assert!(stats(&store).used_bytes <= full * 3 / 4);
        assert!(get(&store, &id(1), 0).is_some(), "recently used survives");
        assert!(
            get(&store, &id(1), 1).is_none(),
            "least recently used goes first"
        );
        assert!(get(&store, &id(1), 19).is_some());
    }

    #[test]
    fn lowering_the_cap_mid_write_keeps_the_new_batch() {
        let store = Store::in_memory(1 << 30, None);
        for k in 0..10 {
            store.put(&id(1), row(k, 100, true, false));
        }
        flush(&store);
        let one = stats(&store).used_bytes / 10;
        // A batch of new rows and a cap below the file's size arrive together.
        for k in 100..105 {
            store.put(&id(1), row(k, 100, true, false));
        }
        store.set_cap(one * 4);
        flush(&store);
        for k in 100..105 {
            assert!(get(&store, &id(1), k).is_some(), "new row {k} kept");
        }
        assert!((0..10).all(|k| get(&store, &id(1), k).is_none()));
    }

    #[test]
    fn clear_keys_and_clear_all() {
        let store = Store::in_memory(1 << 30, None);
        for k in 0..3 {
            store.put(&id(1), row(k, 100, true, false));
            store.put(&id(2), row(k, 100, true, false));
        }
        store.clear(
            &id(1),
            ClearScope::Keys(vec![PositionKey(0), PositionKey(1)]),
        );
        assert!(get(&store, &id(1), 0).is_none());
        assert!(get(&store, &id(1), 2).is_some());
        assert!(
            get(&store, &id(2), 0).is_some(),
            "other identities untouched"
        );
        store.clear(&id(1), ClearScope::All);
        assert!(get(&store, &id(1), 2).is_none());
        assert!(
            get(&store, &id(2), 2).is_none(),
            "everything means every identity"
        );
        assert_eq!(stats(&store).used_bytes, 0);
    }

    #[test]
    fn a_corrupt_file_is_renamed_and_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("analysis.sqlite");
        std::fs::write(&path, vec![0x55u8; 8192]).unwrap();
        let store = Store::open(path.clone(), 1 << 30);
        store.put(&id(1), row(10, 500, true, false));
        flush(&store);
        assert!(stats(&store).persistent);
        assert!(get(&store, &id(1), 10).is_some());
        let aside: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("analysis.corrupt-") && n.ends_with(".sqlite"))
            .collect();
        assert_eq!(aside.len(), 1, "{aside:?}");
    }

    #[test]
    fn an_unwritable_path_runs_in_memory_with_a_reason() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("not-a-folder");
        std::fs::write(&blocker, b"x").unwrap();
        let store = Store::open(blocker.join("analysis.sqlite"), 1 << 30);
        let s = stats(&store);
        assert!(!s.persistent);
        assert!(s.reason.is_some_and(|r| !r.is_empty()));
        store.put(&id(1), row(10, 500, true, false));
        assert!(
            get(&store, &id(1), 10).is_some(),
            "still works for the session"
        );
    }

    #[test]
    fn two_handles_on_one_file_both_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("analysis.sqlite");
        let a = Store::open(path.clone(), 1 << 30);
        let b = Store::open(path.clone(), 1 << 30);
        a.put(&id(1), row(1, 100, true, false));
        b.put(&id(1), row(2, 100, true, false));
        flush(&a);
        flush(&b);
        assert!(get(&a, &id(1), 2).is_some());
        assert!(get(&b, &id(1), 1).is_some());
    }
}
