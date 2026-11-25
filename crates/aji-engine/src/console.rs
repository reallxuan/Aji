//! The engine console (P2 M4 design 6.5): KataGo's stderr and Aji's notes, always; the
//! analysis protocol's lines, only while a console is open somewhere; and the check a query
//! typed into the console passes before it is sent.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

/// Stderr lines and Aji's notes kept, the newest.
pub const LOG_LINES: usize = 1_000;
/// Protocol lines kept while a console is open, the newest.
pub const PROTOCOL_LINES: usize = 5_000;
/// A longer line is cut to this many bytes, and `…` is added.
pub const MAX_LINE_BYTES: usize = 64 * 1024;
/// New lines reach subscribers at most this often.
pub const BATCH_EVERY: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ConsoleKind {
    /// KataGo's stderr.
    Stderr,
    /// Aji's own note; the interface words it from [`ConsoleLine::note`].
    Aji,
    /// A line Aji wrote to KataGo.
    Sent,
    /// A line KataGo wrote to stdout.
    Received,
}

/// What Aji notes in the console. The interface puts it into words, in its own language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ConsoleNote {
    /// KataGo is being started from this program.
    Started { katago: String },
    /// KataGo exited, with this code or signal when known.
    Exited {
        code: Option<i32>,
        signal: Option<i32>,
    },
    /// KataGo did not exit after being killed, and Aji went on without it.
    GaveUp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConsoleLine {
    #[ts(type = "number")]
    pub seq: u64,
    /// Unix time in milliseconds.
    #[ts(type = "number")]
    pub at_ms: u64,
    pub kind: ConsoleKind,
    /// The line as written, cut at [`MAX_LINE_BYTES`]; empty for a note.
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub note: Option<ConsoleNote>,
}

/// Why a console query was not sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ConsoleRefusal {
    /// Not a JSON object.
    NotJson,
    /// A search (no `action`): Aji's own analysis holds the engine, and the owner does not
    /// need searches here (design 6.5).
    Search,
    /// It would end Aji's own analysis.
    TerminateAll,
    /// It would end a query that is not the console's.
    TerminateOther,
}

/// Why [`crate::Engine::console_send`] sent nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsoleSendError {
    Refused(ConsoleRefusal),
    /// KataGo is not running.
    NotRunning,
}

type Subscriber = Arc<dyn Fn(Vec<ConsoleLine>) + Send + Sync>;

#[derive(Default)]
struct State {
    next_seq: u64,
    log: VecDeque<ConsoleLine>,
    protocol: VecDeque<ConsoleLine>,
    pending: Vec<ConsoleLine>,
    subscriber: Option<Subscriber>,
    flush_scheduled: bool,
}

#[derive(Default)]
struct Inner {
    state: Mutex<State>,
    open: AtomicUsize,
    next_query: AtomicU64,
}

/// The console's lines. Cheap to clone: clones share one log.
#[derive(Clone, Default)]
pub struct ConsoleLog {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for ConsoleLog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConsoleLog")
            .field("open", &self.is_open())
            .finish_non_exhaustive()
    }
}

impl ConsoleLog {
    /// Keeps a line. Protocol lines are dropped while no console is open.
    pub fn push(&self, kind: ConsoleKind, text: String) {
        if matches!(kind, ConsoleKind::Sent | ConsoleKind::Received) && !self.is_open() {
            return;
        }
        self.keep(kind, cut(text), None);
    }

    /// Keeps one of Aji's notes.
    pub fn note(&self, note: ConsoleNote) {
        self.keep(ConsoleKind::Aji, String::new(), Some(note));
    }

    /// The kept lines after `seq`, oldest first.
    pub fn lines_after(&self, seq: u64) -> Vec<ConsoleLine> {
        let state = self.state();
        let mut lines: Vec<ConsoleLine> = state
            .log
            .iter()
            .chain(&state.protocol)
            .filter(|l| l.seq > seq)
            .cloned()
            .collect();
        lines.sort_by_key(|l| l.seq);
        lines
    }

    /// A console opened (`true`) or closed (`false`) somewhere. Protocol lines are kept while
    /// at least one is open.
    pub fn set_open(&self, open: bool) {
        if open {
            self.inner.open.fetch_add(1, Ordering::SeqCst);
        } else {
            let _ = self
                .inner
                .open
                .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1));
        }
    }

    pub fn is_open(&self) -> bool {
        self.inner.open.load(Ordering::SeqCst) > 0
    }

    /// Calls `f` with new lines, batched at most every [`BATCH_EVERY`]. Replaces an earlier
    /// subscriber.
    pub fn subscribe(&self, f: impl Fn(Vec<ConsoleLine>) + Send + Sync + 'static) {
        self.state().subscriber = Some(Arc::new(f));
    }

    /// Checks a query typed into the console. Gives the id it goes by (`console-<n>` when it
    /// had none, `console-<id>` for a typed id) and the line to send.
    pub fn console_query(&self, text: &str) -> Result<(String, String), ConsoleRefusal> {
        let Ok(Value::Object(mut query)) = serde_json::from_str::<Value>(text) else {
            return Err(ConsoleRefusal::NotJson);
        };
        match query.get("action").and_then(Value::as_str) {
            None => return Err(ConsoleRefusal::Search),
            Some("terminate_all") => return Err(ConsoleRefusal::TerminateAll),
            Some("terminate") => {
                let target = query.get("terminateId").and_then(Value::as_str);
                if !target.is_some_and(|t| t.starts_with("console-")) {
                    return Err(ConsoleRefusal::TerminateOther);
                }
            }
            Some(_) => {}
        }
        // Every console query goes by a `console-` id, so its reply never reaches one of Aji's
        // own queries (design 6.5): a typed id is kept behind that prefix.
        let id = match query.get("id").and_then(Value::as_str) {
            Some(id) if id.starts_with("console-") => id.to_string(),
            Some(id) => format!("console-{id}"),
            None => {
                let n = self.inner.next_query.fetch_add(1, Ordering::SeqCst) + 1;
                format!("console-{n}")
            }
        };
        query.insert("id".into(), Value::String(id.clone()));
        Ok((id, Value::Object(query).to_string()))
    }

    fn keep(&self, kind: ConsoleKind, text: String, note: Option<ConsoleNote>) {
        let mut state = self.state();
        state.next_seq += 1;
        let line = ConsoleLine {
            seq: state.next_seq,
            at_ms: now_ms(),
            kind,
            text,
            note,
        };
        let (ring, cap) = match kind {
            ConsoleKind::Sent | ConsoleKind::Received => (&mut state.protocol, PROTOCOL_LINES),
            ConsoleKind::Stderr | ConsoleKind::Aji => (&mut state.log, LOG_LINES),
        };
        if ring.len() >= cap {
            ring.pop_front();
        }
        ring.push_back(line.clone());
        if state.subscriber.is_none() {
            return;
        }
        state.pending.push(line);
        if state.flush_scheduled {
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            // No runtime to wait on: deliver now.
            let (lines, subscriber) =
                (std::mem::take(&mut state.pending), state.subscriber.clone());
            drop(state);
            if let Some(subscriber) = subscriber {
                subscriber(lines);
            }
            return;
        };
        state.flush_scheduled = true;
        let log = self.clone();
        runtime.spawn(async move {
            tokio::time::sleep(BATCH_EVERY).await;
            log.flush();
        });
    }

    fn flush(&self) {
        let (lines, subscriber) = {
            let mut state = self.state();
            state.flush_scheduled = false;
            (std::mem::take(&mut state.pending), state.subscriber.clone())
        };
        if let Some(subscriber) = subscriber
            && !lines.is_empty()
        {
            subscriber(lines);
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// `text` cut to [`MAX_LINE_BYTES`] on a character boundary, with `…` added when cut.
fn cut(mut text: String) -> String {
    if text.len() <= MAX_LINE_BYTES {
        return text;
    }
    let mut end = MAX_LINE_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text.push('…');
    text
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::*;

    fn texts(lines: &[ConsoleLine]) -> Vec<&str> {
        lines.iter().map(|l| l.text.as_str()).collect()
    }

    #[test]
    fn rings_keep_their_caps() {
        let log = ConsoleLog::default();
        for i in 0..=LOG_LINES {
            log.push(ConsoleKind::Stderr, format!("line {i}"));
        }
        let lines = log.lines_after(0);
        assert_eq!(lines.len(), LOG_LINES);
        assert_eq!(lines[0].text, "line 1");

        log.set_open(true);
        log.push(ConsoleKind::Received, "x".repeat(70 * 1024));
        let long = log.lines_after(0).pop().unwrap();
        assert!(long.text.ends_with('…'));
        assert_eq!(long.text.len(), MAX_LINE_BYTES + '…'.len_utf8());
    }

    #[test]
    fn a_cut_never_splits_a_character() {
        let log = ConsoleLog::default();
        log.push(ConsoleKind::Stderr, "棋".repeat(30_000));
        let line = log.lines_after(0).pop().unwrap();
        assert!(line.text.ends_with('…'));
        assert!(line.text.len() <= MAX_LINE_BYTES + '…'.len_utf8());
    }

    #[test]
    fn protocol_lines_are_kept_only_while_open() {
        let log = ConsoleLog::default();
        log.push(ConsoleKind::Sent, "before".into());
        log.set_open(true);
        log.push(ConsoleKind::Sent, "sent".into());
        log.push(ConsoleKind::Received, "received".into());
        log.set_open(false);
        log.push(ConsoleKind::Received, "after".into());
        log.push(ConsoleKind::Stderr, "stderr".into());
        assert_eq!(texts(&log.lines_after(0)), ["sent", "received", "stderr"]);
        let first = log.lines_after(0)[0].seq;
        assert_eq!(texts(&log.lines_after(first)), ["received", "stderr"]);
    }

    #[test]
    fn open_counts_and_never_goes_below_zero() {
        let log = ConsoleLog::default();
        log.set_open(false);
        assert!(!log.is_open());
        log.set_open(true);
        log.set_open(true);
        log.set_open(false);
        assert!(log.is_open());
        log.set_open(false);
        log.set_open(false);
        assert!(!log.is_open());
        log.set_open(true);
        assert!(log.is_open());
    }

    #[test]
    fn notes_have_no_text() {
        let log = ConsoleLog::default();
        log.note(ConsoleNote::Exited {
            code: Some(3),
            signal: None,
        });
        let line = log.lines_after(0).pop().unwrap();
        assert_eq!(line.kind, ConsoleKind::Aji);
        assert_eq!(line.text, "");
        assert_eq!(
            line.note,
            Some(ConsoleNote::Exited {
                code: Some(3),
                signal: None
            })
        );
    }

    #[tokio::test(start_paused = true)]
    async fn subscribers_get_batches() {
        let log = ConsoleLog::default();
        let batches = Arc::new(Mutex::new(Vec::<Vec<String>>::new()));
        let seen = Arc::clone(&batches);
        log.subscribe(move |lines| {
            seen.lock()
                .unwrap()
                .push(lines.into_iter().map(|l| l.text).collect())
        });
        log.push(ConsoleKind::Stderr, "a".into());
        tokio::time::sleep(Duration::from_millis(30)).await;
        log.push(ConsoleKind::Stderr, "b".into());
        log.push(ConsoleKind::Stderr, "c".into());
        assert!(
            batches.lock().unwrap().is_empty(),
            "sent before the batch time"
        );
        tokio::time::sleep(BATCH_EVERY).await;
        assert_eq!(*batches.lock().unwrap(), [vec!["a", "b", "c"]]);
        log.push(ConsoleKind::Stderr, "d".into());
        tokio::time::sleep(BATCH_EVERY * 2).await;
        assert_eq!(batches.lock().unwrap().len(), 2);
    }

    #[test]
    fn console_queries_get_an_id_and_dangerous_ones_are_refused() {
        let log = ConsoleLog::default();
        let (id, line) = log.console_query(r#"{"action":"query_version"}"#).unwrap();
        assert_eq!(id, "console-1");
        let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(sent["id"], "console-1");
        assert_eq!(sent["action"], "query_version");

        // A typed id goes out under `console-`, so no reply can end one of Aji's own queries.
        let (id, line) = log
            .console_query(r#"{"action":"clear_cache","id":"mine"}"#)
            .unwrap();
        assert_eq!(id, "console-mine");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&line).unwrap()["id"],
            "console-mine"
        );
        assert_eq!(
            log.console_query(r#"{"action":"nope","id":"aji-12"}"#)
                .map(|(id, _)| id),
            Ok("console-aji-12".to_string())
        );
        assert_eq!(
            log.console_query(
                r#"{"action":"terminate","terminateId":"console-1","id":"console-x"}"#
            )
            .map(|(id, _)| id),
            Ok("console-x".to_string())
        );

        for (text, refusal) in [
            ("not json", ConsoleRefusal::NotJson),
            ("[1,2]", ConsoleRefusal::NotJson),
            (r#"{"moves":[]}"#, ConsoleRefusal::Search),
            (
                r#"{"action":"terminate_all"}"#,
                ConsoleRefusal::TerminateAll,
            ),
            (
                r#"{"action":"terminate","terminateId":"aji-3"}"#,
                ConsoleRefusal::TerminateOther,
            ),
            (r#"{"action":"terminate"}"#, ConsoleRefusal::TerminateOther),
        ] {
            assert_eq!(log.console_query(text), Err(refusal), "{text}");
        }
    }
}
