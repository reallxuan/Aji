//! The engine actor: one Tokio task behind a cloneable [`Engine`] handle. It spawns KataGo,
//! routes its lines, owns the state machine, throttles and caches updates, and runs the
//! watchdog.
//!
//! The actor never awaits I/O. Separate tasks write stdin (fed by a channel), read stdout
//! and stderr, and wait for the process to exit; they report back over a channel, tagged
//! with the process generation so that nothing from an old process is mistaken for the
//! current one.

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::io;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aji_core::{Position, PositionKey};
use tokio::runtime::Handle;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{Instant, sleep_until};

use crate::cache::{AnalysisCache, DEFAULT_CACHE_ENTRIES};
use crate::process::{self, EngineFiles, Spawned, katago_launch, lock};
use crate::query::{action_query, analysis_query, terminate_query};
use crate::response::{KataLine, RawAnalysis, parse_line};
use crate::state::{CrashReason, EngineState, ExitInfo};
use crate::throttle::Throttle;
use crate::update::{AnalysisUpdate, to_update};

const VERSION_ID: &str = "aji-version";

/// Engine tuning. `Default` holds the shipped values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineOptions {
    /// Visits per position; a query is not resubmitted once the cache holds this many.
    /// The most visits per position, `None` for no limit. [`Engine::set_visit_limit`] changes it.
    pub visit_limit: Option<u32>,
    /// KataGo's `reportDuringSearchEvery`.
    pub report_every: Duration,
    /// At most one non-final update per position per this interval.
    pub throttle: Duration,
    /// Candidates kept per update, by KataGo's `order`.
    pub max_candidates: usize,
    /// Positions the analysis cache keeps; the least recently used goes first.
    pub cache_entries: usize,
    /// Lines of stderr kept for the crashed state.
    pub stderr_lines: usize,
    /// How often KataGo is pinged once it is ready.
    pub ping_every: Duration,
    /// An unanswered ping after this long is a hang.
    pub ping_timeout: Duration,
    /// No version reply after this long is a hang.
    pub startup_timeout: Duration,
    /// While analysing, no rise in the active query's root visits for this long is a hang.
    pub stall_timeout: Duration,
    /// A hang is restarted automatically once. The automatically restarted KataGo is not
    /// restarted again if it hangs before answering its version query, or within this
    /// window after answering it; once it has run this long, a hang earns a fresh restart.
    pub hang_window: Duration,
    /// Time between closing stdin and killing KataGo.
    pub shutdown_grace: Duration,
    /// How long a killed KataGo has to report its exit. A process stuck in the kernel (a hung
    /// GPU driver) may never exit; after this the actor gives it up and carries on.
    pub kill_deadline: Duration,
    /// Holds back every exit report, as if each process never exited: tests the give-up.
    #[cfg(feature = "test-seams")]
    pub hold_exit_reports: bool,
}

impl Default for EngineOptions {
    fn default() -> Self {
        EngineOptions {
            visit_limit: None,
            report_every: Duration::from_millis(100),
            throttle: Duration::from_millis(100),
            max_candidates: 20,
            cache_entries: DEFAULT_CACHE_ENTRIES,
            stderr_lines: 50,
            ping_every: Duration::from_secs(5),
            ping_timeout: Duration::from_secs(20),
            startup_timeout: Duration::from_secs(600),
            stall_timeout: Duration::from_secs(60),
            hang_window: Duration::from_secs(10 * 60),
            shutdown_grace: Duration::from_secs(2),
            kill_deadline: Duration::from_secs(5),
            #[cfg(feature = "test-seams")]
            hold_exit_reports: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum EngineEvent {
    State(EngineState),
    Analysis(AnalysisUpdate),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EngineError {
    /// No KataGo is configured.
    NotConfigured,
    /// KataGo is not running (stopped, crashed, not configured, or shut down).
    NotRunning,
    /// The position has a point off the board.
    InvalidPosition,
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            EngineError::NotConfigured => "no KataGo is configured",
            EngineError::NotRunning => "KataGo is not running",
            EngineError::InvalidPosition => "the position has a point off the board",
        })
    }
}

impl std::error::Error for EngineError {}

/// What `state()`, `status()` and `pid()` read without asking the actor.
struct Snapshot {
    state: EngineState,
    pid: Option<u32>,
    position: PositionKey,
    analysis: Option<AnalysisUpdate>,
}

/// The engine's state with the current position and the analysis shown for it.
#[derive(Debug, Clone, PartialEq)]
pub struct EngineStatus {
    pub state: EngineState,
    pub position: PositionKey,
    /// The last update emitted for `position`. On `set_position` it becomes the cached entry
    /// shown at once, or `None`. Otherwise only a newer emitted update replaces it, so
    /// pause, resume and restart keep it until the next report.
    pub analysis: Option<AnalysisUpdate>,
}

type Reply<T> = oneshot::Sender<T>;
type Outcome = Result<(), EngineError>;

enum Command {
    SetPosition(Position, Reply<Outcome>),
    Pause(Reply<Outcome>),
    Resume(Reply<Outcome>),
    Restart(Reply<Outcome>),
    SetFiles(Option<EngineFiles>, Reply<Outcome>),
    Stop(Reply<Outcome>),
    SetVisitLimit(Option<u32>, Reply<Outcome>),
    Shutdown(Reply<()>),
}

/// A cloneable handle to the engine actor.
#[derive(Clone)]
pub struct Engine {
    commands: mpsc::UnboundedSender<Command>,
    snapshot: Arc<Mutex<Snapshot>>,
}

impl fmt::Debug for Engine {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let snapshot = lock(&self.snapshot);
        f.debug_struct("Engine")
            .field("state", &snapshot.state)
            .field("pid", &snapshot.pid)
            .finish()
    }
}

impl Engine {
    /// Starts the actor, and KataGo when `files` is given (`None` gives `notConfigured`).
    /// `on_event` is called from the actor, one event at a time.
    ///
    /// # Panics
    /// Outside a Tokio runtime.
    pub fn spawn(
        files: Option<EngineFiles>,
        position: Position,
        options: EngineOptions,
        on_event: impl Fn(EngineEvent) + Send + Sync + 'static,
    ) -> Engine {
        let runtime = Handle::current();
        let state = match files {
            Some(_) => EngineState::Starting,
            None => EngineState::NotConfigured,
        };
        let snapshot = Arc::new(Mutex::new(Snapshot {
            state: state.clone(),
            pid: None,
            position: position.key(),
            analysis: None,
        }));
        let (commands, command_rx) = mpsc::unbounded_channel();
        let (report_tx, reports) = mpsc::unbounded_channel();
        let cache = AnalysisCache::with_capacity(options.cache_entries);
        let actor = Actor {
            throttle: Throttle::new(options.throttle),
            files,
            options,
            on_event: Box::new(on_event),
            snapshot: Arc::clone(&snapshot),
            runtime: runtime.clone(),
            commands: command_rx,
            commands_open: true,
            reports,
            report_tx,
            state,
            position,
            paused: false,
            cache,
            queries: HashMap::new(),
            current: None,
            next_id: 1,
            generation: 0,
            process: None,
            stop_waiters: Vec::new(),
            shutdown_waiters: Vec::new(),
            finished: false,
        };
        runtime.spawn(actor.run());
        Engine { commands, snapshot }
    }

    pub fn state(&self) -> EngineState {
        lock(&self.snapshot).state.clone()
    }

    /// The state, the current position and the analysis shown for it, read together.
    pub fn status(&self) -> EngineStatus {
        let snapshot = lock(&self.snapshot);
        EngineStatus {
            state: snapshot.state.clone(),
            position: snapshot.position,
            analysis: snapshot.analysis.clone(),
        }
    }

    /// KataGo's process id while a process exists.
    pub fn pid(&self) -> Option<u32> {
        lock(&self.snapshot).pid
    }

    /// Makes `position` current. Returns once the change is applied: no update for another
    /// position is emitted afterwards. A position with a point off the board gives
    /// `InvalidPosition` and changes nothing.
    pub async fn set_position(&self, position: Position) -> Result<(), EngineError> {
        self.outcome(|reply| Command::SetPosition(position, reply))
            .await
    }

    pub async fn pause(&self) -> Result<(), EngineError> {
        self.outcome(Command::Pause).await
    }

    pub async fn resume(&self) -> Result<(), EngineError> {
        self.outcome(Command::Resume).await
    }

    /// Stops KataGo if it runs and starts it again. Returns once `starting` is entered.
    pub async fn restart(&self) -> Result<(), EngineError> {
        self.outcome(Command::Restart).await
    }

    /// Runs other KataGo files from now on, keeping the position. With files, KataGo restarts
    /// on them and this returns once `starting` is entered; with `None` it is stopped and this
    /// returns once the state is `notConfigured`. The analysis shown and cached is dropped,
    /// since another engine or network gives other numbers.
    pub async fn set_files(&self, files: Option<EngineFiles>) -> Result<(), EngineError> {
        self.outcome(|reply| Command::SetFiles(files, reply)).await
    }

    /// Closes stdin, waits up to `shutdown_grace`, then kills. Returns once KataGo has
    /// exited and the state is `stopped`.
    pub async fn stop(&self) -> Result<(), EngineError> {
        self.outcome(Command::Stop).await
    }

    /// Changes the most visits per position (`None`: no limit), in every state. A search past
    /// the new limit stops; a running search restarts under it; a position that stopped at the
    /// old limit is searched again when the new one is higher.
    pub async fn set_visit_limit(&self, limit: Option<u32>) -> Result<(), EngineError> {
        self.outcome(|reply| Command::SetVisitLimit(limit, reply))
            .await
    }

    /// Stops KataGo like `stop` and ends the actor. Later calls report `NotRunning`.
    pub async fn shutdown(&self) {
        self.ask(Command::Shutdown).await;
    }

    async fn ask<T>(&self, command: impl FnOnce(Reply<T>) -> Command) -> Option<T> {
        let (reply, answer) = oneshot::channel();
        self.commands.send(command(reply)).ok()?;
        answer.await.ok()
    }

    async fn outcome(&self, command: impl FnOnce(Reply<Outcome>) -> Command) -> Outcome {
        self.ask(command)
            .await
            .unwrap_or(Err(EngineError::NotRunning))
    }
}

/// What the spawner thread and the per-process tasks report, tagged with the generation of
/// the process they belong to.
enum Report {
    Spawned(u64, io::Result<Box<Spawned>>),
    Line(u64, KataLine),
    Exited(u64, ExitInfo, Vec<String>),
}

/// What happens once a process that is being ended has exited.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Then {
    Stop,
    /// A restart the user asked for.
    Restart,
    /// The automatic restart after a hang.
    RestartAfterHang,
    Shutdown,
    NotResponding,
    /// The files were taken away: `notConfigured` once the process is gone.
    Unconfigure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum End {
    /// Close stdin, then kill after `shutdown_grace`.
    Gracefully,
    /// Kill now.
    Kill,
}

/// One KataGo process, from the spawn request until its exit is reported.
struct Proc {
    generation: u64,
    phase: Phase,
    /// `None` until the spawner reports back.
    io: Option<ProcIo>,
    /// Set once the process is being ended, or is to be ended as soon as it has spawned.
    then: Option<Then>,
    /// When the shutdown grace runs out.
    kill_at: Option<Instant>,
    /// Once killed: when the actor stops waiting for the exit report.
    give_up_at: Option<Instant>,
    /// Started by the automatic restart after a hang.
    automatic: bool,
    /// When it answered its version query.
    answered_at: Option<Instant>,
}

enum Phase {
    Spawning,
    AwaitingVersion { deadline: Instant },
    Ready { version: String, ping: Ping },
}

enum Ping {
    Due(Instant),
    Waiting { id: String, since: Instant },
}

/// The query for the current position that has not been terminated, with the progress
/// clock the stall watchdog reads.
struct Active {
    id: String,
    /// The most root visits seen for this query.
    visits: u32,
    /// When `visits` last rose, or when the query was submitted.
    progress_at: Instant,
}

struct ProcIo {
    stdin: Option<mpsc::UnboundedSender<String>>,
    writer: JoinHandle<()>,
    kill: Option<oneshot::Sender<()>>,
    /// Owns the process handle. Aborting it drops the handle, which kills the process.
    supervisor: JoinHandle<()>,
}

impl ProcIo {
    /// Closes stdin now, even if a write is blocked on a full pipe.
    fn close_stdin(&mut self) {
        self.stdin = None;
        self.writer.abort();
    }

    fn kill(&mut self) {
        if let Some(kill) = self.kill.take() {
            let _ = kill.send(());
        }
    }
}

impl Drop for ProcIo {
    fn drop(&mut self) {
        self.writer.abort();
        // Done already unless the process was given up after its kill.
        self.supervisor.abort();
    }
}

struct Actor {
    files: Option<EngineFiles>,
    options: EngineOptions,
    on_event: Box<dyn Fn(EngineEvent) + Send + Sync>,
    snapshot: Arc<Mutex<Snapshot>>,
    runtime: Handle,
    commands: mpsc::UnboundedReceiver<Command>,
    commands_open: bool,
    reports: mpsc::UnboundedReceiver<Report>,
    report_tx: mpsc::UnboundedSender<Report>,

    state: EngineState,
    position: Position,
    paused: bool,
    cache: AnalysisCache,
    throttle: Throttle,
    /// In-flight analysis queries, with the position each was submitted for. A terminated
    /// query stays until its final, `noResults` or error arrives.
    queries: HashMap<String, Position>,
    /// The query for the current position that has not been terminated.
    current: Option<Active>,
    next_id: u64,
    generation: u64,
    process: Option<Proc>,
    stop_waiters: Vec<Reply<Outcome>>,
    shutdown_waiters: Vec<Reply<()>>,
    finished: bool,
}

async fn sleep_until_some(at: Option<Instant>) {
    match at {
        Some(at) => sleep_until(at).await,
        None => std::future::pending().await,
    }
}

impl Actor {
    async fn run(mut self) {
        (self.on_event)(EngineEvent::State(self.state.clone()));
        if self.files.is_some() {
            self.start_process(false);
        }
        while !self.finished {
            let wake = self.next_wake();
            tokio::select! {
                command = self.commands.recv(), if self.commands_open => match command {
                    Some(command) => self.on_command(command),
                    None => {
                        // Every handle is gone.
                        self.commands_open = false;
                        self.shutdown();
                    }
                },
                Some(report) = self.reports.recv() => self.on_report(report),
                () = sleep_until_some(wake) => self.on_timer(Instant::now()),
            }
        }
    }

    // -------------------------------------------------------------- commands

    fn on_command(&mut self, command: Command) {
        match command {
            Command::SetPosition(position, reply) => {
                let _ = reply.send(self.set_position(position));
            }
            Command::Pause(reply) => {
                let _ = reply.send(self.pause());
            }
            Command::Resume(reply) => {
                let _ = reply.send(self.resume());
            }
            Command::Restart(reply) => {
                let _ = reply.send(self.restart());
            }
            Command::SetFiles(files, reply) => self.set_files(files, reply),
            Command::Stop(reply) => self.stop(reply),
            Command::SetVisitLimit(limit, reply) => {
                let _ = reply.send(self.set_visit_limit(limit));
            }
            Command::Shutdown(reply) => {
                self.shutdown_waiters.push(reply);
                self.shutdown();
            }
        }
    }

    fn set_position(&mut self, position: Position) -> Outcome {
        if position.validate().is_err() {
            return Err(EngineError::InvalidPosition);
        }
        if position == self.position {
            return Ok(());
        }
        self.terminate_current();
        self.position = position;
        self.throttle = Throttle::new(self.options.throttle);
        {
            let mut snapshot = lock(&self.snapshot);
            snapshot.position = self.position.key();
            snapshot.analysis = None;
        }
        if let Some(cached) = self.cache.get(self.position.key()).cloned() {
            self.throttle.admit(std::time::Instant::now(), true);
            self.emit(EngineEvent::Analysis(cached));
        }
        if let Some(version) = self.ready_version() {
            self.analyse_or_idle(version);
        }
        Ok(())
    }

    fn set_visit_limit(&mut self, limit: Option<u32>) -> Outcome {
        if self.options.visit_limit == limit {
            return Ok(());
        }
        self.options.visit_limit = limit;
        let Some(version) = self.ready_version() else {
            return Ok(());
        };
        if self.paused {
            return Ok(());
        }
        if let Some(active) = &self.current {
            let reached = limit.is_some_and(|l| active.visits >= l);
            self.terminate_current();
            if reached {
                self.set_state(EngineState::Ready { version });
                return Ok(());
            }
        }
        self.analyse_or_idle(version);
        Ok(())
    }

    fn pause(&mut self) -> Outcome {
        if !self.running() {
            return Err(EngineError::NotRunning);
        }
        self.paused = true;
        if let Some(version) = self.ready_version() {
            self.terminate_current();
            self.set_state(EngineState::Paused { version });
        }
        Ok(())
    }

    fn resume(&mut self) -> Outcome {
        if !self.running() {
            return Err(EngineError::NotRunning);
        }
        let was_paused = std::mem::replace(&mut self.paused, false);
        if was_paused && let Some(version) = self.ready_version() {
            self.analyse_or_idle(version);
        }
        Ok(())
    }

    fn restart(&mut self) -> Outcome {
        if self.files.is_none() {
            return Err(EngineError::NotConfigured);
        }
        if self.shutting_down() {
            return Err(EngineError::NotRunning);
        }
        if self.process.is_some() {
            self.announce_restart();
            self.end_process(Then::Restart, End::Gracefully);
        } else {
            self.start_process(false);
        }
        Ok(())
    }

    fn set_files(&mut self, files: Option<EngineFiles>, reply: Reply<Outcome>) {
        if self.shutting_down() {
            let _ = reply.send(Err(EngineError::NotRunning));
            return;
        }
        self.files = files;
        self.cache = AnalysisCache::with_capacity(self.options.cache_entries);
        self.throttle = Throttle::new(self.options.throttle);
        lock(&self.snapshot).analysis = None;
        if self.files.is_some() {
            if self.process.is_some() {
                self.announce_restart();
                self.end_process(Then::Restart, End::Gracefully);
            } else {
                self.start_process(false);
            }
            let _ = reply.send(Ok(()));
        } else if self.process.is_some() {
            self.stop_waiters.push(reply);
            self.end_process(Then::Unconfigure, End::Gracefully);
        } else {
            self.set_state(EngineState::NotConfigured);
            let _ = reply.send(Ok(()));
        }
    }

    fn stop(&mut self, reply: Reply<Outcome>) {
        if self.files.is_none() {
            let _ = reply.send(Err(EngineError::NotConfigured));
        } else if self.process.is_none() {
            let _ = reply.send(Ok(()));
        } else {
            self.stop_waiters.push(reply);
            self.end_process(Then::Stop, End::Gracefully);
        }
    }

    fn shutdown(&mut self) {
        if self.process.is_some() {
            self.end_process(Then::Shutdown, End::Gracefully);
        } else {
            self.finish();
        }
    }

    // --------------------------------------------------------------- process

    /// Starts a new KataGo. `automatic` marks the restart after a hang.
    fn start_process(&mut self, automatic: bool) {
        let Some(files) = &self.files else { return };
        eprintln!("aji: starting KataGo {}", files.katago.display());
        let spec = katago_launch(files);
        self.generation += 1;
        let generation = self.generation;
        self.process = Some(Proc {
            generation,
            phase: Phase::Spawning,
            io: None,
            then: None,
            kill_at: None,
            give_up_at: None,
            automatic,
            answered_at: None,
        });
        self.set_state(EngineState::Starting);
        let reports = self.report_tx.clone();
        process::request_spawn(spec, self.runtime.clone(), move |result| {
            // If the actor is gone the result is dropped, which kills the process.
            let _ = reports.send(Report::Spawned(generation, result.map(Box::new)));
        });
    }

    /// Begins ending the process: closes stdin and kills now or after the grace. Stops all
    /// analysis bookkeeping, since nothing from this process counts any more.
    fn end_process(&mut self, then: Then, end: End) {
        let grace = self.options.shutdown_grace;
        let kill_deadline = self.options.kill_deadline;
        let Some(process) = self.process.as_mut() else {
            return;
        };
        if process.then != Some(Then::Shutdown) {
            process.then = Some(then);
        }
        if let Some(io) = process.io.as_mut() {
            io.close_stdin();
            match end {
                End::Kill => {
                    io.kill();
                    process
                        .give_up_at
                        .get_or_insert(Instant::now() + kill_deadline);
                }
                End::Gracefully => {
                    process.kill_at.get_or_insert(Instant::now() + grace);
                }
            }
        }
        self.current = None;
        self.queries.clear();
    }

    fn on_report(&mut self, report: Report) {
        match report {
            Report::Spawned(generation, result) => self.on_spawned(generation, result),
            Report::Line(generation, line) => {
                if self.is_live(generation) {
                    self.on_line(line);
                }
            }
            Report::Exited(generation, exit, tail) => {
                if self.is_current(generation) {
                    self.process_gone(Some(exit), tail, CrashReason::Exited);
                }
            }
        }
    }

    fn on_spawned(&mut self, generation: u64, result: io::Result<Box<Spawned>>) {
        if !self.is_current(generation) {
            return;
        }
        let spawned = match result {
            Ok(spawned) => spawned,
            Err(e) => {
                let tail = vec![format!("aji: could not start KataGo: {:?}", e.kind())];
                self.process_gone(None, tail, CrashReason::SpawnFailed);
                return;
            }
        };
        let pid = spawned.pid;
        let io = self.attach(generation, *spawned);
        lock(&self.snapshot).pid = Some(pid);
        let deadline = Instant::now() + self.options.startup_timeout;
        let Some(process) = self.process.as_mut() else {
            return;
        };
        process.io = Some(io);
        match process.then {
            Some(then) => self.end_process(then, End::Gracefully),
            None => {
                process.phase = Phase::AwaitingVersion { deadline };
                self.send(action_query(VERSION_ID, "query_version"));
            }
        }
    }

    /// Starts the tasks that write stdin, read stdout and stderr, and wait for the exit.
    fn attach(&self, generation: u64, spawned: Spawned) -> ProcIo {
        let Spawned {
            process,
            pid: _,
            stdin,
            stdout,
            stderr,
        } = spawned;
        let (stdin_tx, stdin_rx) = mpsc::unbounded_channel();
        let writer = tokio::spawn(process::write_lines(stdin, stdin_rx));

        let reports = self.report_tx.clone();
        let stdout_reader = tokio::spawn(process::read_lines(stdout, move |line| {
            reports
                .send(Report::Line(generation, parse_line(&line)))
                .is_ok()
        }));
        let tail = Arc::new(Mutex::new(VecDeque::new()));
        let stderr_reader = tokio::spawn(process::keep_stderr_tail(
            stderr,
            self.options.stderr_lines,
            Arc::clone(&tail),
        ));

        let (kill, kill_rx) = oneshot::channel();
        let reports = self.report_tx.clone();
        #[cfg(feature = "test-seams")]
        let hold = self.options.hold_exit_reports;
        #[cfg(not(feature = "test-seams"))]
        let hold = false;
        let supervisor = tokio::spawn(async move {
            let readers = vec![stdout_reader, stderr_reader];
            let (exit, tail) = process::supervise(process, kill_rx, readers, tail).await;
            if !hold {
                let _ = reports.send(Report::Exited(generation, exit, tail));
            }
        });
        ProcIo {
            stdin: Some(stdin_tx),
            writer,
            kill: Some(kill),
            supervisor,
        }
    }

    /// The process has exited, or never started. Applies what was asked of it, or reports
    /// the crash.
    fn process_gone(&mut self, exit: Option<ExitInfo>, tail: Vec<String>, unexpected: CrashReason) {
        let then = self.process.take().and_then(|process| process.then);
        lock(&self.snapshot).pid = None;
        self.current = None;
        self.queries.clear();
        let crashed = |reason| EngineState::Crashed {
            reason,
            exit,
            stderr_tail: tail,
        };
        match then {
            None => self.set_state(crashed(unexpected)),
            Some(Then::NotResponding) => self.set_state(crashed(CrashReason::NotResponding)),
            Some(Then::Stop) => self.set_state(EngineState::Stopped),
            Some(Then::Unconfigure) => self.set_state(EngineState::NotConfigured),
            Some(Then::Restart) => self.start_process(false),
            Some(Then::RestartAfterHang) => self.start_process(true),
            Some(Then::Shutdown) => {
                self.set_state(EngineState::Stopped);
                self.finish();
            }
        }
        for waiter in self.stop_waiters.drain(..) {
            let _ = waiter.send(Ok(()));
        }
    }

    /// Ends the actor once nothing is left running.
    fn finish(&mut self) {
        self.finished = true;
        for waiter in self.stop_waiters.drain(..) {
            let _ = waiter.send(Ok(()));
        }
        for waiter in self.shutdown_waiters.drain(..) {
            let _ = waiter.send(());
        }
    }

    // -------------------------------------------------------------- watchdog

    fn next_wake(&self) -> Option<Instant> {
        let process = self.process.as_ref()?;
        if process.then.is_some() {
            return [process.kill_at, process.give_up_at]
                .into_iter()
                .flatten()
                .min();
        }
        let watchdog = match &process.phase {
            Phase::Spawning => None,
            Phase::AwaitingVersion { deadline } => Some(*deadline),
            Phase::Ready {
                ping: Ping::Due(at),
                ..
            } => Some(*at),
            Phase::Ready {
                ping: Ping::Waiting { since, .. },
                ..
            } => Some(*since + self.options.ping_timeout),
        };
        [watchdog, self.stalled_at()].into_iter().flatten().min()
    }

    fn on_timer(&mut self, now: Instant) {
        let ping_timeout = self.options.ping_timeout;
        let kill_deadline = self.options.kill_deadline;
        // `current` is cleared whenever a process starts ending, so this concerns a live one.
        if self.stalled_at().is_some_and(|at| now >= at) {
            self.on_hang(now);
            return;
        }
        let Some(process) = self.process.as_mut() else {
            return;
        };
        if process.then.is_some() {
            if process.give_up_at.is_some_and(|at| now >= at) {
                let why = "aji: KataGo did not exit after kill; giving it up";
                eprintln!("{why}");
                self.process_gone(None, vec![why.to_string()], CrashReason::Exited);
                return;
            }
            if process.kill_at.is_some_and(|at| now >= at) {
                process.kill_at = None;
                if let Some(io) = process.io.as_mut() {
                    io.kill();
                    process.give_up_at = Some(now + kill_deadline);
                }
            }
            return;
        }
        let hung = match &process.phase {
            Phase::Spawning => false,
            Phase::AwaitingVersion { deadline } => now >= *deadline,
            Phase::Ready {
                ping: Ping::Waiting { since, .. },
                ..
            } => now >= *since + ping_timeout,
            Phase::Ready {
                ping: Ping::Due(at),
                ..
            } => {
                if now >= *at {
                    self.ping(now);
                }
                false
            }
        };
        if hung {
            self.on_hang(now);
        }
    }

    fn ping(&mut self, now: Instant) {
        let id = format!("aji-ping-{}", self.next_id);
        self.next_id += 1;
        if let Some(Proc {
            phase: Phase::Ready { ping, .. },
            ..
        }) = self.process.as_mut()
        {
            *ping = Ping::Waiting {
                id: id.clone(),
                since: now,
            };
        }
        self.send(action_query(&id, "query_version"));
    }

    /// Kills a hung KataGo: no version reply in time, an unanswered ping, or a search whose
    /// visits stopped rising. A hang restarts KataGo once. If the restarted one hangs before
    /// answering its version query, or within `hang_window` after answering, it is reported
    /// as not responding instead.
    fn on_hang(&mut self, now: Instant) {
        let window = self.options.hang_window;
        let Some(process) = self.process.as_ref() else {
            return;
        };
        // The restarted KataGo had its chance unless it answered and then ran a full window.
        let again = process.automatic
            && process
                .answered_at
                .is_none_or(|at| now.duration_since(at) < window);
        if again {
            self.end_process(Then::NotResponding, End::Kill);
        } else {
            self.announce_restart();
            self.end_process(Then::RestartAfterHang, End::Kill);
        }
    }

    // ------------------------------------------------------------ KataGo lines

    fn on_line(&mut self, line: KataLine) {
        match line {
            KataLine::Analysis(raw) => self.on_analysis(raw),
            KataLine::Ack {
                id,
                action,
                version,
            } if action == "query_version" => self.on_version_reply(&id, version),
            KataLine::NoResults { id } | KataLine::QueryError { id: Some(id), .. } => {
                self.query_ended(&id);
            }
            // KataGo already writes errors and warnings to stderr (`logToStderr=true`).
            KataLine::Ack { .. }
            | KataLine::QueryError { id: None, .. }
            | KataLine::Warning { .. }
            | KataLine::Unrecognised(_) => {}
        }
    }

    fn on_version_reply(&mut self, id: &str, version: Option<String>) {
        let now = Instant::now();
        let next_ping = now + self.options.ping_every;
        let Some(process) = self.process.as_mut() else {
            return;
        };
        match &mut process.phase {
            Phase::AwaitingVersion { .. } if id == VERSION_ID => {
                let version = version.unwrap_or_default();
                process.answered_at = Some(now);
                process.phase = Phase::Ready {
                    version: version.clone(),
                    ping: Ping::Due(next_ping),
                };
                self.analyse_or_idle(version);
            }
            Phase::Ready { ping, .. } => {
                if matches!(ping, Ping::Waiting { id: waiting, .. } if *waiting == *id) {
                    *ping = Ping::Due(next_ping);
                }
            }
            _ => {}
        }
    }

    fn on_analysis(&mut self, raw: RawAnalysis) {
        let Some(position) = self.queries.get(&raw.id) else {
            return;
        };
        let update = to_update(&raw, position, self.options.max_candidates);
        if let Some(active) = self.current.as_mut().filter(|a| a.id == raw.id)
            && raw.root_info.visits > active.visits
        {
            active.visits = raw.root_info.visits;
            active.progress_at = Instant::now();
        }
        let key = update.position;
        let is_final = update.is_final;
        // The cache keeps the most-visited result per position, for the visit cap and for
        // showing a known result at once on `set_position`. What is shown is the live search:
        // KataGo starts every query from zero visits, so after a resume or a restart the new
        // search must be visible from its first report, not held back until it passes the old
        // count. A query that is no longer the active one (a late final after a newer query
        // started) is cached but not shown.
        let live = self.is_active(&raw.id) || self.current.is_none();
        self.cache.offer(update.clone());
        if live
            && key == self.position.key()
            && self.throttle.admit(std::time::Instant::now(), is_final)
        {
            self.emit(EngineEvent::Analysis(update));
        }
        if is_final {
            self.query_ended(&raw.id);
        }
    }

    /// A query ended with a final, `noResults` or an error. If it was the current one, the
    /// search is over.
    fn query_ended(&mut self, id: &str) {
        if self.queries.remove(id).is_none() || !self.is_active(id) {
            return;
        }
        self.current = None;
        if let EngineState::Analysing { version } = &self.state {
            let version = version.clone();
            self.set_state(EngineState::Ready { version });
        }
    }

    // ---------------------------------------------------------------- helpers

    /// Submits a query for the current position unless paused, invalid or capped, and
    /// moves to the matching state. Only called once KataGo has answered its version query.
    fn analyse_or_idle(&mut self, version: String) {
        if self.paused {
            self.set_state(EngineState::Paused { version });
            return;
        }
        if self.current.is_none() && self.wants_analysis() {
            self.submit();
        }
        let state = match self.current {
            Some(_) => EngineState::Analysing { version },
            None => EngineState::Ready { version },
        };
        self.set_state(state);
    }

    fn wants_analysis(&mut self) -> bool {
        // The position given at spawn is not validated; `analysis_query` would refuse it.
        self.position.validate().is_ok()
            && self.cache.get(self.position.key()).is_none_or(|cached| {
                self.options
                    .visit_limit
                    .is_none_or(|limit| cached.root_visits < limit)
            })
    }

    fn submit(&mut self) {
        let id = format!("aji-{}", self.next_id);
        self.next_id += 1;
        let Ok(line) = analysis_query(
            &id,
            &self.position,
            self.options.visit_limit,
            self.options.report_every,
        ) else {
            return;
        };
        self.send(line);
        self.queries.insert(id.clone(), self.position.clone());
        self.current = Some(Active {
            id,
            visits: 0,
            progress_at: Instant::now(),
        });
    }

    fn terminate_current(&mut self) {
        if let Some(target) = self.current.take() {
            let id = format!("aji-terminate-{}", self.next_id);
            self.next_id += 1;
            self.send(terminate_query(&id, &target.id));
        }
    }

    /// Queues a line for KataGo's stdin. Never waits.
    fn send(&self, line: String) {
        let stdin = self
            .process
            .as_ref()
            .and_then(|process| process.io.as_ref())
            .and_then(|io| io.stdin.as_ref());
        if let Some(stdin) = stdin {
            let _ = stdin.send(line);
        }
    }

    /// KataGo's version, once it has answered and while it is not being ended.
    fn ready_version(&self) -> Option<String> {
        let process = self.process.as_ref().filter(|p| p.then.is_none())?;
        match &process.phase {
            Phase::Ready { version, .. } => Some(version.clone()),
            Phase::Spawning | Phase::AwaitingVersion { .. } => None,
        }
    }

    fn running(&self) -> bool {
        matches!(
            self.state,
            EngineState::Starting
                | EngineState::Ready { .. }
                | EngineState::Analysing { .. }
                | EngineState::Paused { .. }
        ) && !self.shutting_down()
    }

    fn shutting_down(&self) -> bool {
        self.process
            .as_ref()
            .is_some_and(|process| process.then == Some(Then::Shutdown))
    }

    fn is_active(&self, id: &str) -> bool {
        self.current.as_ref().is_some_and(|active| active.id == id)
    }

    /// When the active query counts as stalled, while analysing.
    fn stalled_at(&self) -> Option<Instant> {
        if !matches!(self.state, EngineState::Analysing { .. }) {
            return None;
        }
        let active = self.current.as_ref()?;
        Some(active.progress_at + self.options.stall_timeout)
    }

    /// Enters `starting` for a new attempt. A restart is a transition even from `starting`,
    /// so it is announced even then.
    fn announce_restart(&mut self) {
        let state = EngineState::Starting;
        self.state = state.clone();
        lock(&self.snapshot).state = state.clone();
        self.emit(EngineEvent::State(state));
    }

    fn is_current(&self, generation: u64) -> bool {
        self.process
            .as_ref()
            .is_some_and(|process| process.generation == generation)
    }

    /// The process of `generation` exists and is not being ended.
    fn is_live(&self, generation: u64) -> bool {
        self.process
            .as_ref()
            .is_some_and(|process| process.generation == generation && process.then.is_none())
    }

    fn set_state(&mut self, state: EngineState) {
        if self.state == state {
            return;
        }
        self.state = state.clone();
        lock(&self.snapshot).state = state.clone();
        self.emit(EngineEvent::State(state));
    }

    fn emit(&self, event: EngineEvent) {
        if let EngineEvent::Analysis(update) = &event {
            lock(&self.snapshot).analysis = Some(update.clone());
        }
        (self.on_event)(event);
    }
}
