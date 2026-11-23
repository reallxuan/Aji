//! Drives `Engine` against the `fake-katago` binary: start-up, streaming, crashes, hangs,
//! pause and resume, position changes, stop, odd paths, and a force-quit of the host.

use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc as std_mpsc;
use std::thread;
use std::time::Duration;

use aji_core::{BoardSize, Color, Komi, Move, Point, Position, Rules};
use aji_engine::{
    AnalysisUpdate, ClearScope, CrashReason, Engine, EngineError, EngineEvent, EngineFiles,
    EngineIdentity, EngineOptions, EngineState, NextResult, Rejection, Row, Store, TrendStats,
    katago_launch, move_loss,
};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};
use tokio::time::{Instant, timeout, timeout_at};

/// The deadline for every wait.
const WAIT: Duration = Duration::from_secs(10);
const VERSION: &str = "1.18.2";

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn scenario(name: &str) -> PathBuf {
    manifest_dir()
        .join("tests/fixtures/scenarios")
        .join(format!("{name}.json"))
}

fn fake_katago() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-katago"))
}

fn files(name: &str) -> EngineFiles {
    EngineFiles {
        katago: fake_katago(),
        model: PathBuf::from("model.bin.gz"),
        config: scenario(name),
        working_dir: manifest_dir(),
        path_prepend: Vec::new(),
    }
}

fn options() -> EngineOptions {
    EngineOptions {
        ping_every: Duration::from_millis(50),
        ping_timeout: Duration::from_millis(400),
        startup_timeout: Duration::from_secs(5),
        shutdown_grace: Duration::from_millis(500),
        throttle: Duration::ZERO,
        submit_interval: Duration::ZERO,
        ..EngineOptions::default()
    }
}

/// The shipped submission gate, for the tests of rapid navigation.
fn gated(interval_ms: u64) -> EngineOptions {
    EngineOptions {
        submit_interval: Duration::from_millis(interval_ms),
        ..options()
    }
}

fn position(moves: &[(Color, u8, u8)]) -> Position {
    let mut p = Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap());
    p.moves = moves
        .iter()
        .map(|&(c, x, y)| (c, Move::Play(Point { x, y })))
        .collect();
    p
}

/// B Q16, W D4.
fn p1() -> Position {
    position(&[(Color::Black, 15, 3), (Color::White, 3, 15)])
}

/// B R4.
fn p2() -> Position {
    position(&[(Color::Black, 16, 15)])
}

/// B D16: the fake has no recording for it and answers a `QueryError` for `moves`.
fn unrecorded() -> Position {
    position(&[(Color::Black, 3, 3)])
}

fn not_responding(state: &EngineState) -> bool {
    matches!(
        state,
        EngineState::Crashed {
            reason: CrashReason::NotResponding,
            ..
        }
    )
}

fn analysing() -> EngineState {
    EngineState::Analysing {
        version: VERSION.into(),
    }
}

fn paused() -> EngineState {
    EngineState::Paused {
        version: VERSION.into(),
    }
}

fn ready() -> EngineState {
    EngineState::Ready {
        version: VERSION.into(),
        limit_reached: false,
    }
}

/// Ready because the position reached its visit limit.
fn at_limit() -> EngineState {
    EngineState::Ready {
        version: VERSION.into(),
        limit_reached: true,
    }
}

fn is_ready(state: &EngineState) -> bool {
    matches!(state, EngineState::Ready { .. })
}

fn capped(limit: u32) -> EngineOptions {
    EngineOptions {
        visit_limit: Some(limit),
        ..options()
    }
}

/// An engine whose events are collected into a channel.
struct Probe {
    engine: Engine,
    events: UnboundedReceiver<EngineEvent>,
}

fn start(files: Option<EngineFiles>, position: Position) -> Probe {
    start_with(files, position, options())
}

fn start_with(files: Option<EngineFiles>, position: Position, options: EngineOptions) -> Probe {
    let (tx, events) = unbounded_channel();
    let engine = Engine::spawn(files, position, options, move |event| {
        let _ = tx.send(event);
    });
    Probe { engine, events }
}

impl Probe {
    /// The next event, failing the test if none arrives by `deadline`.
    async fn next_by(&mut self, deadline: Instant) -> EngineEvent {
        timeout_at(deadline, self.events.recv())
            .await
            .expect("timed out waiting for an engine event")
            .expect("the engine dropped its event callback")
    }

    async fn next(&mut self) -> EngineEvent {
        self.next_by(Instant::now() + WAIT).await
    }

    async fn next_state(&mut self) -> EngineState {
        let deadline = Instant::now() + WAIT;
        loop {
            if let EngineEvent::State(state) = self.next_by(deadline).await {
                return state;
            }
        }
    }

    async fn next_analysis(&mut self) -> AnalysisUpdate {
        let deadline = Instant::now() + WAIT;
        loop {
            if let EngineEvent::Analysis(update) = self.next_by(deadline).await {
                return update;
            }
        }
    }

    /// Collects events up to and including the first that matches, within one deadline, so
    /// a stream that never stops still fails the test.
    async fn until(&mut self, wanted: impl Fn(&EngineEvent) -> bool) -> Vec<EngineEvent> {
        let deadline = Instant::now() + WAIT;
        let mut seen = Vec::new();
        loop {
            let event = self.next_by(deadline).await;
            let done = wanted(&event);
            seen.push(event);
            if done {
                return seen;
            }
        }
    }

    /// Collects events up to and including the first state that matches.
    async fn until_state(&mut self, wanted: impl Fn(&EngineState) -> bool) -> Vec<EngineEvent> {
        self.until(|e| matches!(e, EngineEvent::State(s) if wanted(s)))
            .await
    }

    /// Collects events up to and including the first final update.
    async fn until_final(&mut self) -> Vec<EngineEvent> {
        self.until(|e| matches!(e, EngineEvent::Analysis(u) if u.is_final))
            .await
    }

    /// Everything emitted so far that has not been received.
    fn drain(&mut self) -> Vec<EngineEvent> {
        let mut seen = Vec::new();
        while let Ok(event) = self.events.try_recv() {
            seen.push(event);
        }
        seen
    }

    /// Everything emitted during the next `quiet`.
    async fn collect_for(&mut self, quiet: Duration) -> Vec<EngineEvent> {
        let end = Instant::now() + quiet;
        let mut seen = Vec::new();
        while let Ok(Some(event)) = timeout_at(end, self.events.recv()).await {
            seen.push(event);
        }
        seen
    }
}

/// Awaits an engine call, failing the test if it does not return within the deadline.
async fn bounded<T>(call: impl Future<Output = T>) -> T {
    timeout(WAIT, call)
        .await
        .expect("timed out waiting for an engine call")
}

fn updates(events: &[EngineEvent]) -> Vec<&AnalysisUpdate> {
    events
        .iter()
        .filter_map(|e| match e {
            EngineEvent::Analysis(u) => Some(u),
            _ => None,
        })
        .collect()
}

fn states(events: &[EngineEvent]) -> Vec<&EngineState> {
    events
        .iter()
        .filter_map(|e| match e {
            EngineEvent::State(s) => Some(s),
            _ => None,
        })
        .collect()
}

#[cfg(unix)]
fn alive(pid: u32) -> bool {
    let pid = libc::pid_t::try_from(pid).expect("pid fits pid_t");
    // SAFETY: signal 0 only checks that the process exists.
    if unsafe { libc::kill(pid, 0) } != 0 {
        return std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH);
    }
    !zombie(pid)
}

/// A zombie has exited and only waits for its new parent to reap it.
#[cfg(target_os = "linux")]
fn zombie(pid: libc::pid_t) -> bool {
    fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| {
        stat.rsplit_once(')')
            .is_some_and(|(_, rest)| rest.trim_start().starts_with('Z'))
    })
}

#[cfg(all(unix, not(target_os = "linux")))]
fn zombie(_pid: libc::pid_t) -> bool {
    false
}

#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: the handle is checked before use and closed exactly once.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(process, &mut code);
        CloseHandle(process);
        ok != 0 && code == STILL_ACTIVE as u32
    }
}

#[test]
fn launch_args_are_exact() {
    let files = EngineFiles {
        katago: PathBuf::from("/opt/katago/katago"),
        model: PathBuf::from("models/b18.bin.gz"),
        config: PathBuf::from("my configs/analysis.cfg"),
        working_dir: PathBuf::from("/opt/katago"),
        path_prepend: Vec::new(),
    };
    let spec = katago_launch(&files);
    assert_eq!(spec.program, PathBuf::from("/opt/katago/katago"));
    let want: Vec<OsString> = [
        "analysis",
        "-config",
        "my configs/analysis.cfg",
        "-model",
        "models/b18.bin.gz",
        "-quit-without-waiting",
        "-override-config",
        "reportAnalysisWinratesAs=BLACK,logToStderr=true",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    assert_eq!(spec.args, want);
    assert_eq!(spec.working_dir, PathBuf::from("/opt/katago"));
}

#[tokio::test]
async fn reaches_analysing_and_streams_updates() {
    let mut p = start(Some(files("normal")), p1());
    assert_eq!(p.engine.state(), EngineState::Starting);
    assert_eq!(p.next().await, EngineEvent::State(EngineState::Starting));
    assert_eq!(p.next().await, EngineEvent::State(analysing()));

    let events: Vec<_> = p
        .until_state(|_| true)
        .await
        .into_iter()
        .filter(|e| !matches!(e, EngineEvent::Stored { .. }))
        .collect();
    let (last, streamed) = events.split_last().unwrap();
    assert_eq!(last, &EngineEvent::State(ready()));
    let streamed = updates(streamed);
    assert_eq!(
        streamed.len(),
        events.len() - 1,
        "only updates before ready"
    );
    let (fin, reports) = streamed.split_last().expect("a final update");
    assert!(fin.is_final);
    assert!(reports.len() >= 2, "got {} reports", reports.len());
    assert!(reports.iter().all(|u| !u.is_final));
    assert!(streamed.iter().all(|u| u.position == p1().key()));
    assert!(
        reports
            .windows(2)
            .all(|w| w[1].root_visits > w[0].root_visits),
        "visits must rise"
    );
    assert!(fin.root_visits >= reports.last().unwrap().root_visits);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn startup_failure_reports_crash_with_stderr_tail() {
    let mut p = start(Some(files("startup-failure")), p1());
    assert_eq!(p.next_state().await, EngineState::Starting);
    match p.next_state().await {
        EngineState::Crashed {
            reason: CrashReason::Exited,
            exit: Some(exit),
            stderr_tail,
        } => {
            assert_ne!(exit.code, Some(0));
            #[cfg(unix)]
            assert_eq!(exit.signal, Some(6));
            let last = stderr_tail.last().expect("stderr tail");
            assert!(last.starts_with("libc++abi"), "last line: {last}");
        }
        other => panic!("expected crashed/exited, got {other:?}"),
    }
    assert_eq!(p.engine.pid(), None);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn missing_binary_reports_spawn_failed() {
    let mut f = files("normal");
    f.katago = manifest_dir().join("no-such-katago");
    let mut p = start(Some(f), p1());
    assert_eq!(p.next_state().await, EngineState::Starting);
    assert_eq!(
        p.next_state().await,
        EngineState::Crashed {
            reason: CrashReason::SpawnFailed,
            exit: None,
            stderr_tail: vec!["aji: could not start KataGo: NotFound".into()],
        }
    );
    assert_eq!(p.engine.pid(), None);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn crash_mid_analysis_keeps_the_last_50_lines() {
    let mut p = start(Some(files("crash")), p1());
    let seen = p
        .until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    let states = states(&seen);
    assert_eq!(states[..2], [&EngineState::Starting, &analysing()]);
    match states.last().unwrap() {
        EngineState::Crashed {
            reason: CrashReason::Exited,
            exit: Some(exit),
            stderr_tail,
        } => {
            assert_ne!(exit.code, Some(0));
            assert_eq!(stderr_tail.len(), 50);
            let want: Vec<String> = (12..=60).map(|n| format!("fake crash line {n}")).collect();
            assert_eq!(stderr_tail[..49], want[..]);
            assert!(
                stderr_tail[49].starts_with("libc++abi"),
                "{}",
                stderr_tail[49]
            );
        }
        other => panic!("expected crashed/exited, got {other:?}"),
    }
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn restart_after_crash_returns_to_analysing() {
    let mut p = start(Some(files("crash")), p1());
    p.until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    assert_eq!(bounded(p.engine.restart()).await, Ok(()));
    assert_eq!(p.next_state().await, EngineState::Starting);
    assert_eq!(p.next_state().await, analysing());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn pause_then_resume() {
    let mut p = start(Some(files("slow")), p1());
    p.until_state(|s| *s == analysing()).await;
    p.next_analysis().await;

    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    assert_eq!(p.engine.state(), paused());
    let mut after = p.drain();
    let at = after
        .iter()
        .position(|e| *e == EngineEvent::State(paused()))
        .expect("paused was emitted");
    after.drain(..=at);
    if !updates(&after).iter().any(|u| u.is_final) {
        after.extend(p.until_final().await);
    }
    let after = updates(&after);
    let (last, before_final) = after.split_last().unwrap();
    assert!(last.is_final, "the final emitted after the pause");
    assert_eq!(last.position, p1().key());
    // The search stops at once: only a report already in flight may precede the final.
    assert!(
        before_final.len() <= 1,
        "{} reports after pausing",
        before_final.len()
    );
    let quiet = p.collect_for(Duration::from_millis(400)).await;
    assert!(quiet.is_empty(), "nothing after the final: {quiet:?}");

    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    assert_eq!(p.next_state().await, analysing());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn resume_shows_the_live_search() {
    // KataGo starts every query from zero visits. The resumed search is shown from its first
    // report, rather than held back until it passes the count shown before the pause.
    let mut p = start(Some(files("slow")), p1());
    p.until_state(|s| *s == analysing()).await;
    p.next_analysis().await;
    p.next_analysis().await;

    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    let mut before = p.drain();
    if !updates(&before).iter().any(|u| u.is_final) {
        before.extend(p.until_final().await);
    }
    before.extend(p.collect_for(Duration::from_millis(200)).await);
    let last_before = updates(&before).last().unwrap().root_visits;

    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    let after = p.until_state(|s| *s == ready()).await;
    assert_eq!(states(&after), [&analysing(), &ready()]);
    let after = updates(&after);
    let visits: Vec<u32> = after.iter().map(|u| u.root_visits).collect();
    assert!(
        visits.first().is_some_and(|&v| v < last_before),
        "the resumed search is shown from its first report: {visits:?} after {last_before}"
    );
    assert!(
        visits.windows(2).all(|w| w[0] <= w[1]),
        "the resumed search only rises: {visits:?}"
    );
    assert!(after.last().unwrap().is_final);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn restart_after_crash_shows_the_live_search() {
    // The restarted KataGo searches from zero visits; its reports must reach the panel at once,
    // even though the crashed search had already shown more visits.
    let mut p = start(Some(files("crash")), p1());
    let first = p
        .until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    assert!(!updates(&first).is_empty(), "the first search was shown");

    assert_eq!(bounded(p.engine.restart()).await, Ok(()));
    // The crash scenario crashes every process after the same reports.
    let again = p
        .until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    assert!(
        !updates(&again).is_empty(),
        "the restarted search was shown: {again:?}"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn stale_position_updates_are_not_emitted() {
    let mut p = start(Some(files("slow")), p1());
    p.until_state(|s| *s == analysing()).await;
    assert_eq!(p.next_analysis().await.position, p1().key());

    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    p.drain();
    let mut after = p.until_state(|s| *s == ready()).await;
    // `ready` comes from P2's own final, not from the final of P1's terminated query.
    let before_ready = updates(&after);
    let last = before_ready.last().expect("P2 reported before ready");
    assert!(last.is_final, "ready came before P2's final");
    assert_eq!(last.position, p2().key());
    after.extend(p.collect_for(Duration::from_millis(300)).await);
    let after = updates(&after);
    assert!(after.iter().any(|u| u.position == p2().key()));
    assert!(
        after.iter().all(|u| u.position != p1().key()),
        "a P1 update was emitted after the switch"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn stop_ends_the_process() {
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == analysing()).await;
    let pid = p.engine.pid().expect("a pid while analysing");
    assert!(alive(pid));

    assert_eq!(bounded(p.engine.stop()).await, Ok(()));
    assert_eq!(p.engine.state(), EngineState::Stopped);
    assert!(!alive(pid), "KataGo {pid} is still alive");
    assert_eq!(p.engine.pid(), None);
    assert!(
        p.drain()
            .contains(&EngineEvent::State(EngineState::Stopped))
    );

    assert_eq!(bounded(p.engine.stop()).await, Ok(()));
    assert_eq!(
        bounded(p.engine.pause()).await,
        Err(EngineError::NotRunning)
    );
    assert_eq!(
        bounded(p.engine.resume()).await,
        Err(EngineError::NotRunning)
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn stop_kills_a_katago_that_ignores_eof() {
    let mut p = start(Some(files("ignore-eof")), p1());
    p.until_state(|s| *s == analysing()).await;
    let pid = p.engine.pid().expect("a pid while analysing");

    let asked = Instant::now();
    assert_eq!(bounded(p.engine.stop()).await, Ok(()));
    assert!(
        asked.elapsed() >= options().shutdown_grace,
        "stopped before the grace ran out, so the kill path did not run"
    );
    assert_eq!(p.engine.state(), EngineState::Stopped);
    assert!(!alive(pid), "KataGo {pid} is still alive");
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn not_configured_rejects_commands() {
    let mut p = start(None, p1());
    assert_eq!(p.engine.state(), EngineState::NotConfigured);
    assert_eq!(
        p.next().await,
        EngineEvent::State(EngineState::NotConfigured)
    );
    assert_eq!(
        bounded(p.engine.pause()).await,
        Err(EngineError::NotRunning)
    );
    assert_eq!(
        bounded(p.engine.resume()).await,
        Err(EngineError::NotRunning)
    );
    assert_eq!(
        bounded(p.engine.restart()).await,
        Err(EngineError::NotConfigured)
    );
    assert_eq!(
        bounded(p.engine.stop()).await,
        Err(EngineError::NotConfigured)
    );
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    assert_eq!(p.engine.state(), EngineState::NotConfigured);
    assert_eq!(p.engine.pid(), None);
    bounded(p.engine.shutdown()).await;
    assert!(p.drain().is_empty());
}

#[tokio::test]
async fn hang_restarts_once_then_reports_not_responding() {
    let mut p = start(Some(files("hang")), p1());
    let seen = p
        .until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    let states = states(&seen);
    assert_eq!(
        states[..4],
        [
            &EngineState::Starting,
            &analysing(),
            &EngineState::Starting,
            &analysing()
        ]
    );
    assert_eq!(states.len(), 5, "{states:?}");
    assert!(matches!(
        states[4],
        EngineState::Crashed {
            reason: CrashReason::NotResponding,
            ..
        }
    ));
    assert_eq!(p.engine.pid(), None);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn stalled_search_counts_as_a_hang() {
    let options = EngineOptions {
        stall_timeout: Duration::from_millis(500),
        ..options()
    };
    let mut p = start_with(Some(files("stall")), p1(), options);
    let seen = p
        .until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    let states = states(&seen);
    assert_eq!(
        states[..4],
        [
            &EngineState::Starting,
            &analysing(),
            &EngineState::Starting,
            &analysing()
        ]
    );
    assert_eq!(states.len(), 5, "{states:?}");
    assert!(not_responding(states[4]), "{:?}", states[4]);
    assert!(
        !updates(&seen).is_empty(),
        "the search reported before it stalled"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn progressing_search_is_not_a_stall() {
    // At speed 2, P1 reports rising visits every ~130 ms for about a second, which is longer
    // than the stall timeout: only a clock that resets on progress lets it finish.
    let options = EngineOptions {
        stall_timeout: Duration::from_millis(500),
        ..options()
    };
    let mut p = start_with(Some(files("slow")), p1(), options);
    let seen = p
        .until_state(|s| !matches!(s, EngineState::Starting | EngineState::Analysing { .. }))
        .await;
    assert_eq!(
        states(&seen),
        [&EngineState::Starting, &analysing(), &ready()]
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn query_error_ends_analysis_in_ready() {
    let mut p = start(Some(files("normal")), unrecorded());
    let seen = p.until_state(|s| *s == ready()).await;
    assert_eq!(
        states(&seen),
        [&EngineState::Starting, &analysing(), &ready()]
    );
    assert!(updates(&seen).is_empty());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn pause_while_starting_lands_in_paused() {
    let mut p = start(Some(files("slow")), p1());
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    assert_eq!(p.engine.state(), EngineState::Starting);
    let seen = p.until_state(|s| !matches!(s, EngineState::Starting)).await;
    assert_eq!(states(&seen), [&EngineState::Starting, &paused()]);
    let quiet = p.collect_for(Duration::from_millis(600)).await;
    assert!(
        updates(&seen).is_empty() && quiet.is_empty(),
        "no query was submitted: {quiet:?}"
    );

    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    assert_eq!(p.next_state().await, analysing());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn restart_while_analysing_returns_to_analysing() {
    let mut p = start(Some(files("slow")), p1());
    p.until_state(|s| *s == analysing()).await;
    let old = p.engine.pid().expect("a pid while analysing");

    assert_eq!(bounded(p.engine.restart()).await, Ok(()));
    assert_eq!(p.engine.state(), EngineState::Starting);
    let seen = p.until_state(|s| *s == analysing()).await;
    assert_eq!(states(&seen), [&EngineState::Starting, &analysing()]);
    assert!(!alive(old), "the old KataGo {old} is still alive");
    assert_ne!(p.engine.pid(), Some(old));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn startup_timeout_counts_as_a_hang() {
    let options = EngineOptions {
        startup_timeout: Duration::from_millis(300),
        ..options()
    };
    let mut p = start_with(Some(files("slow-start")), p1(), options);
    let seen = p
        .until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    let states = states(&seen);
    assert_eq!(states.len(), 3, "{states:?}");
    assert_eq!(
        states[..2],
        [&EngineState::Starting, &EngineState::Starting]
    );
    assert!(not_responding(states[2]), "{:?}", states[2]);
    assert_eq!(p.engine.pid(), None);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn startup_hang_after_automatic_restart_is_final() {
    // The defaults allow 600 s for start-up against a 10-minute window, so the restarted
    // KataGo's hang lands outside the window. The same ratio, scaled down: the restarted
    // KataGo never answered, so it is not restarted again.
    let options = EngineOptions {
        startup_timeout: Duration::from_millis(300),
        hang_window: Duration::from_millis(300),
        ..options()
    };
    let mut p = start_with(Some(files("slow-start")), p1(), options);
    let seen = p
        .until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    let states = states(&seen);
    assert_eq!(states.len(), 3, "{states:?}");
    assert_eq!(
        states[..2],
        [&EngineState::Starting, &EngineState::Starting]
    );
    assert!(not_responding(states[2]), "{:?}", states[2]);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn healthy_restart_earns_a_fresh_restart() {
    // Every `hang` KataGo answers its version query, then stops answering pings about
    // 450 ms later. With a 100 ms window each restarted one has run a full window first,
    // so each hang is restarted again.
    let options = EngineOptions {
        hang_window: Duration::from_millis(100),
        ..options()
    };
    let mut p = start_with(Some(files("hang")), p1(), options);
    let mut states_seen = Vec::new();
    while states_seen.len() < 6 {
        let state = p.next_state().await;
        assert!(
            !matches!(state, EngineState::Crashed { .. }),
            "{states_seen:?} then {state:?}"
        );
        states_seen.push(state);
    }
    let cycle = [EngineState::Starting, analysing()];
    assert_eq!(states_seen, [&cycle[..], &cycle[..], &cycle[..]].concat());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn capped_position_is_not_reanalysed() {
    // P1's final has 315 visits, above this cap.
    let options = EngineOptions {
        visit_limit: Some(100),
        ..options()
    };
    let mut p = start_with(Some(files("normal")), p1(), options);
    p.until_state(|s| *s == at_limit()).await;

    // On resume.
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    assert_eq!(p.next_state().await, paused());
    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    assert_eq!(p.next_state().await, at_limit());

    // After the version reply of a new process.
    assert_eq!(bounded(p.engine.restart()).await, Ok(()));
    let seen = p.until_state(|s| *s != EngineState::Starting).await;
    assert_eq!(states(&seen), [&EngineState::Starting, &at_limit()]);

    // On switching back: the cached entry is emitted at once, and nothing is submitted.
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    p.until_state(is_ready).await;
    assert_eq!(bounded(p.engine.set_position(p1())).await, Ok(()));
    let back = p.drain();
    // The cached update, and `ready` now at P1's limit (P2's final is below 100 visits).
    let shown = updates(&back);
    assert_eq!(shown.len(), 1, "{back:?}");
    assert!(states(&back).iter().all(|s| **s == at_limit()), "{back:?}");
    let cached = shown[0];
    assert_eq!(cached.position, p1().key());
    assert!(cached.is_final && cached.root_visits >= 100);
    let quiet = p.collect_for(Duration::from_millis(500)).await;
    assert!(
        quiet.is_empty(),
        "a capped position was analysed: {quiet:?}"
    );
    assert_eq!(p.engine.state(), at_limit());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn off_board_position_is_never_submitted() {
    let mut off_board = p1();
    off_board
        .moves
        .push((Color::Black, Move::Play(Point { x: 19, y: 0 })));
    assert!(off_board.validate().is_err());

    // From the start, the version reply leads to ready.
    let mut p = start(Some(files("normal")), off_board.clone());
    let seen = p.until_state(|s| *s != EngineState::Starting).await;
    assert_eq!(states(&seen), [&EngineState::Starting, &ready()]);

    // The actor still runs and answers commands.
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    assert_eq!(p.next_state().await, paused());
    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    assert_eq!(p.next_state().await, ready());
    assert_eq!(bounded(p.engine.set_position(p1())).await, Ok(()));
    assert_eq!(p.next_state().await, analysing());

    // Switching to it while analysing is refused and changes nothing.
    assert_eq!(
        bounded(p.engine.set_position(off_board)).await,
        Err(EngineError::InvalidPosition)
    );
    assert_eq!(p.engine.state(), analysing());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn set_position_rejects_an_off_board_move() {
    let mut off_board = p1();
    off_board
        .moves
        .push((Color::Black, Move::Play(Point { x: 19, y: 0 })));
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == analysing()).await;
    p.drain();

    assert_eq!(
        bounded(p.engine.set_position(off_board)).await,
        Err(EngineError::InvalidPosition)
    );
    assert_eq!(p.engine.status().position, Some(p1().key()));
    let after = p.collect_for(Duration::from_millis(300)).await;
    assert!(
        updates(&after).iter().all(|u| u.position == p1().key()),
        "an update carried another key: {after:?}"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn status_carries_the_latest_analysis() {
    let mut p = start(Some(files("normal")), p1());
    let mut last = p.next_analysis().await;
    // Paused, no new search starts; the terminated one's last report arrives promptly. After a
    // quiet spell, the last update received is the last one emitted.
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    let mut events = p.until_state(|s| *s == paused()).await;
    events.extend(p.collect_for(Duration::from_millis(300)).await);
    if let Some(update) = updates(&events).last() {
        last = (*update).clone();
    }
    let status = p.engine.status();
    assert_eq!(status.position, Some(p1().key()));
    assert_eq!(status.analysis, Some(last));

    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    let status = p.engine.status();
    assert_eq!(status.position, Some(p2().key()));
    assert_eq!(status.analysis, None);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn clear_position_stops_analysis() {
    let mut p = start(Some(files("slow")), p1());
    p.until_state(|s| *s == analysing()).await;
    p.next_analysis().await;

    assert_eq!(bounded(p.engine.clear_position()).await, Ok(()));
    let mut seen = p.until_state(|s| *s == ready()).await;
    seen.extend(p.collect_for(Duration::from_millis(400)).await);
    let after_ready = seen
        .iter()
        .position(|e| *e == EngineEvent::State(ready()))
        .unwrap();
    assert!(
        updates(&seen[after_ready..]).is_empty(),
        "an update after clearing: {seen:?}"
    );
    let status = p.engine.status();
    assert_eq!(status.position, None);
    assert_eq!(status.analysis, None);
    assert_eq!(p.engine.state(), ready());

    // The same position as before is analysed again once it is set.
    assert_eq!(bounded(p.engine.set_position(p1())).await, Ok(()));
    assert_eq!(p.engine.status().position, Some(p1().key()));
    p.until(|e| matches!(e, EngineEvent::Analysis(u) if u.position == p1().key()))
        .await;
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn clear_position_while_paused_stays_paused() {
    let mut p = start(Some(files("slow")), p1());
    p.until_state(|s| *s == analysing()).await;
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    p.until_state(|s| *s == paused()).await;
    assert_eq!(bounded(p.engine.clear_position()).await, Ok(()));
    assert_eq!(p.engine.state(), paused());
    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    assert_eq!(p.next_state().await, ready());
    bounded(p.engine.shutdown()).await;
}

fn copy_into(from: &Path, to: &Path) {
    fs::create_dir_all(to.parent().unwrap()).unwrap();
    fs::copy(from, to).unwrap();
}

#[tokio::test]
async fn starts_from_a_folder_with_cjk_and_spaces() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("棋谱 测试");
    let katago = dir.join(fake_katago().file_name().unwrap());
    copy_into(&fake_katago(), &katago);
    copy_into(&scenario("normal"), &dir.join("scenarios/normal.json"));
    copy_into(
        &manifest_dir().join("tests/fixtures/katago/1.18.2-metal/analysis.jsonl"),
        &dir.join("katago/1.18.2-metal/analysis.jsonl"),
    );
    let files = EngineFiles {
        katago,
        model: PathBuf::from("model.bin.gz"),
        config: PathBuf::from("scenarios/normal.json"),
        working_dir: dir,
        path_prepend: Vec::new(),
    };
    let mut p = start(Some(files), p1());
    let mut retries = 0;
    loop {
        let seen = p.until_state(|s| !matches!(s, EngineState::Starting)).await;
        match states(&seen).last() {
            // Linux "Text file busy": a test thread forked while the copy was still open for
            // writing. That is a property of the test, not of the engine.
            Some(EngineState::Crashed {
                reason: CrashReason::SpawnFailed,
                stderr_tail,
                ..
            }) if retries < 3 && stderr_tail.iter().any(|l| l.contains("ExecutableFileBusy")) => {
                retries += 1;
                assert_eq!(bounded(p.engine.restart()).await, Ok(()));
            }
            last => {
                assert_eq!(last, Some(&&analysing()));
                break;
            }
        }
    }
    bounded(p.engine.shutdown()).await;
}

#[test]
fn force_quit_leaves_no_engine() {
    // On macOS the mechanism is stdin EOF; elsewhere the fake ignores EOF, which proves the
    // OS mechanism (the parent-death signal on Linux, the job object on Windows).
    let name = if cfg!(target_os = "macos") {
        "normal"
    } else {
        "ignore-eof"
    };
    let mut host = Command::new(env!("CARGO_BIN_EXE_engine-host"))
        .arg(fake_katago())
        .arg(scenario(name))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn engine-host");
    let stdout = host.stdout.take().unwrap();
    let (tx, rx) = std_mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let line = rx.recv_timeout(WAIT).expect("engine-host printed no pid");
    let pid: u32 = line
        .strip_prefix("pid ")
        .and_then(|n| n.parse().ok())
        .unwrap_or_else(|| panic!("unexpected engine-host output {line:?}"));
    assert!(alive(pid));

    host.kill().unwrap();
    host.wait().unwrap();

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while alive(pid) {
        assert!(
            std::time::Instant::now() < deadline,
            "KataGo {pid} outlived its host"
        );
        thread::sleep(Duration::from_millis(20));
    }
}

#[tokio::test]
async fn set_files_switches_to_the_new_files() {
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == analysing()).await;
    let old = p.engine.pid().expect("a pid while analysing");

    // A config that fails at start-up proves the new files are the ones launched.
    assert_eq!(
        bounded(p.engine.set_files(Some(files("startup-failure")), None)).await,
        Ok(())
    );
    assert_eq!(p.engine.state(), EngineState::Starting);
    let events = p
        .until_state(|s| matches!(s, EngineState::Crashed { .. }))
        .await;
    assert!(states(&events).contains(&&EngineState::Starting));
    assert!(!alive(old), "the old KataGo {old} is still alive");

    // And back: the installer's fallback switches from a failed engine to a working one.
    assert_eq!(
        bounded(p.engine.set_files(Some(files("normal")), None)).await,
        Ok(())
    );
    p.until_state(|s| *s == analysing()).await;
    let new = p.engine.pid().expect("a pid while analysing");
    assert_ne!(new, old);
    assert_eq!(
        p.engine.status().position,
        Some(p1().key()),
        "the position is kept"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn set_files_none_stops_and_reports_not_configured() {
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == analysing()).await;
    let pid = p.engine.pid().expect("a pid while analysing");

    assert_eq!(bounded(p.engine.set_files(None, None)).await, Ok(()));
    assert_eq!(p.engine.state(), EngineState::NotConfigured);
    assert_eq!(p.engine.pid(), None);
    assert!(!alive(pid), "KataGo {pid} is still alive");
    assert!(
        p.drain()
            .contains(&EngineEvent::State(EngineState::NotConfigured))
    );
    assert_eq!(
        bounded(p.engine.restart()).await,
        Err(EngineError::NotConfigured)
    );

    // Not configured, files can be given again.
    assert_eq!(
        bounded(p.engine.set_files(Some(files("normal")), None)).await,
        Ok(())
    );
    p.until_state(|s| *s == analysing()).await;
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn set_files_drops_the_old_analysis() {
    let mut p = start(Some(files("normal")), p1());
    p.until_final().await;
    assert!(p.engine.status().analysis.is_some());

    assert_eq!(
        bounded(p.engine.set_files(Some(files("normal")), None)).await,
        Ok(())
    );
    assert_eq!(
        p.engine.status().analysis,
        None,
        "another network gives other numbers"
    );
    // Paused at once, the new KataGo analyses nothing, so the cache stays as the switch left
    // it: coming back to P1 shows no cached result from the old files.
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    p.until_state(|s| *s == paused()).await;
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    assert_eq!(bounded(p.engine.set_position(p1())).await, Ok(()));
    assert_eq!(p.engine.status().analysis, None);

    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    p.next_analysis().await;
    assert!(p.engine.status().analysis.is_some());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn an_unkillable_process_is_given_up_after_the_kill_deadline() {
    let options = EngineOptions {
        kill_deadline: Duration::from_millis(300),
        hold_exit_reports: true,
        ..options()
    };
    let mut p = start_with(Some(files("normal")), p1(), options.clone());
    p.until_state(|s| *s == analysing()).await;

    let asked = Instant::now();
    assert_eq!(bounded(p.engine.stop()).await, Ok(()));
    let took = asked.elapsed();
    let limit = options.shutdown_grace + options.kill_deadline;
    assert!(took >= limit, "returned after {took:?}, before the give-up");
    assert!(took < limit + Duration::from_secs(1), "took {took:?}");
    assert_eq!(p.engine.state(), EngineState::Stopped);
    assert_eq!(p.engine.pid(), None);
    bounded(p.engine.shutdown()).await;
}

// ---------------------------------------------------------------- M5: a visit limit that changes

/// Waits for an analysis update of at least `visits` root visits.
async fn until_visits(p: &mut Probe, visits: u32) {
    loop {
        if let EngineEvent::Analysis(update) = p.next().await
            && update.root_visits >= visits
        {
            return;
        }
    }
}

#[tokio::test]
async fn lowering_the_limit_below_current_visits_terminates_the_query() {
    let mut p = start(Some(files("slow")), p1());
    p.until_state(|s| *s == analysing()).await;
    until_visits(&mut p, 107).await;
    assert_eq!(bounded(p.engine.set_visit_limit(Some(100))).await, Ok(()));
    p.until_state(|s| *s == at_limit()).await;
    let quiet = p.collect_for(Duration::from_millis(500)).await;
    assert!(
        states(&quiet).is_empty(),
        "no new search after the lowered limit: {quiet:?}"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn raising_the_limit_resubmits_a_capped_position() {
    let options = EngineOptions {
        visit_limit: Some(100),
        ..options()
    };
    let mut p = start_with(Some(files("normal")), p1(), options);
    p.until_state(|s| *s == at_limit()).await;
    // P1's final has 315 visits: below 1000, so it is searched again.
    assert_eq!(bounded(p.engine.set_visit_limit(Some(1000))).await, Ok(()));
    p.until_state(|s| *s == analysing()).await;
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn removing_the_limit_resubmits_a_capped_position() {
    let options = EngineOptions {
        visit_limit: Some(100),
        ..options()
    };
    let mut p = start_with(Some(files("normal")), p1(), options);
    p.until_state(|s| *s == at_limit()).await;
    assert_eq!(bounded(p.engine.set_visit_limit(None)).await, Ok(()));
    p.until_state(|s| *s == analysing()).await;
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn a_limit_change_while_paused_does_not_submit() {
    let options = EngineOptions {
        visit_limit: Some(100),
        ..options()
    };
    let mut p = start_with(Some(files("normal")), p1(), options);
    p.until_state(|s| *s == at_limit()).await;
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    assert_eq!(p.next_state().await, paused());
    assert_eq!(bounded(p.engine.set_visit_limit(None)).await, Ok(()));
    let quiet = p.collect_for(Duration::from_millis(500)).await;
    assert!(states(&quiet).is_empty(), "{quiet:?}");
    assert_eq!(p.engine.state(), paused());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn the_limit_is_kept_across_restart_and_set_files() {
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == ready()).await;
    // The cached final has 315 visits; a limit of 100 caps it from now on.
    assert_eq!(bounded(p.engine.set_visit_limit(Some(100))).await, Ok(()));
    assert_eq!(p.next_state().await, at_limit());
    assert_eq!(bounded(p.engine.restart()).await, Ok(()));
    let seen = p.until_state(|s| *s != EngineState::Starting).await;
    assert_eq!(states(&seen), [&EngineState::Starting, &at_limit()]);
    assert_eq!(
        bounded(p.engine.set_files(Some(files("normal")), None)).await,
        Ok(())
    );
    // New files clear the cache, so P1 is searched again, to its final.
    p.until_state(|s| *s == at_limit()).await;
    // Its 315-visit final is at or above the kept limit: resume does not search again.
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    assert_eq!(p.next_state().await, paused());
    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    assert_eq!(p.next_state().await, at_limit());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn setting_a_limit_without_an_engine_succeeds() {
    let p = start(None, p1());
    assert_eq!(bounded(p.engine.set_visit_limit(Some(5))).await, Ok(()));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn a_burst_ends_on_the_last_position() {
    let mut p = start_with(Some(files("normal")), p1(), gated(100));
    p.until_state(|s| *s == analysing()).await;
    let begun = Instant::now();
    for i in 0..15 {
        let position = if i % 2 == 0 { p1() } else { p2() };
        assert_eq!(bounded(p.engine.set_position(position)).await, Ok(()));
        tokio::time::sleep(Duration::from_millis(9)).await;
    }
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    assert!(begun.elapsed() < Duration::from_millis(400));
    p.drain();
    let after = p
        .until(|e| matches!(e, EngineEvent::Analysis(u) if u.is_final && u.position == p2().key()))
        .await;
    let after = updates(&after);
    assert!(
        after.iter().all(|u| u.position == p2().key()),
        "an update for another position came after the last set_position"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn a_single_step_is_not_delayed() {
    // A long interval: any wait for the gate would show.
    let mut p = start_with(Some(files("normal")), p1(), gated(2_000));
    p.until_state(|s| *s == analysing()).await;
    // Let the interval since P1's submission run out.
    tokio::time::sleep(Duration::from_millis(2_100)).await;
    p.drain();
    let asked = Instant::now();
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    let first = p.next_analysis().await;
    assert_eq!(first.position, p2().key());
    assert!(
        asked.elapsed() < Duration::from_millis(1_000),
        "the first P2 update took {:?}",
        asked.elapsed()
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn a_position_inside_the_interval_waits_for_it() {
    let mut p = start_with(Some(files("normal")), p1(), gated(2_000));
    p.until_state(|s| *s == analysing()).await;
    p.drain();
    let asked = Instant::now();
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    let first = p.next_analysis().await;
    assert_eq!(first.position, p2().key());
    assert!(
        asked.elapsed() >= Duration::from_millis(1_500),
        "P2 was submitted inside the interval"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn waiting_for_the_gate_is_analysing_and_not_a_hang() {
    let options = EngineOptions {
        stall_timeout: Duration::from_millis(150),
        ..gated(400)
    };
    let mut p = start_with(Some(files("normal")), p1(), options);
    p.until_state(|s| *s == analysing()).await;
    p.drain();
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    assert_eq!(p.engine.state(), analysing());
    let events = p
        .until(|e| matches!(e, EngineEvent::Analysis(u) if u.position == p2().key()))
        .await;
    assert!(
        states(&events).iter().all(|s| **s == analysing()),
        "the state left analysing while waiting: {:?}",
        states(&events)
    );
    bounded(p.engine.shutdown()).await;
}

// P1's recorded final has 315 visits, and the fake ignores `maxVisits`: it always replays the
// whole recording.

#[tokio::test]
async fn stopping_at_the_limit_reports_limit_reached() {
    let mut p = start_with(Some(files("normal")), p1(), capped(100));
    let seen = p.until_state(is_ready).await;
    assert_eq!(states(&seen).last(), Some(&&at_limit()));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn continue_searches_again_from_the_cached_depth() {
    let mut p = start_with(Some(files("normal")), p1(), capped(100));
    p.until_state(|s| *s == at_limit()).await;
    assert_eq!(bounded(p.engine.continue_analysis()).await, Ok(()));
    assert_eq!(p.next_state().await, analysing());
    let seen = p.until_state(is_ready).await;
    let new = updates(&seen);
    assert!(!new.is_empty());
    assert!(new.iter().all(|u| u.previous_visits == 315), "{new:?}");
    // The new target is 315 + 100, which the recording never reaches.
    assert_eq!(states(&seen).last(), Some(&&ready()));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn a_raised_target_survives_navigation() {
    let mut p = start_with(Some(files("normal")), p1(), capped(100));
    p.until_state(|s| *s == at_limit()).await;
    assert_eq!(bounded(p.engine.continue_analysis()).await, Ok(()));
    p.until_final().await;
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    p.until_state(is_ready).await;
    // Back on P1: 315 visits are below its raised target of 415, so it is searched again,
    // where the plain limit of 100 would leave it alone.
    assert_eq!(bounded(p.engine.set_position(p1())).await, Ok(()));
    let back = p
        .until(|e| matches!(e, EngineEvent::Analysis(u) if !u.is_final))
        .await;
    assert!(states(&back).contains(&&analysing()), "{back:?}");
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn continue_without_a_limit_does_nothing() {
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == ready()).await;
    assert_eq!(bounded(p.engine.continue_analysis()).await, Ok(()));
    let quiet = p.collect_for(Duration::from_millis(400)).await;
    assert!(quiet.is_empty(), "{quiet:?}");
    assert_eq!(p.engine.state(), ready());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn set_files_clears_targets() {
    let mut p = start_with(Some(files("normal")), p1(), capped(100));
    p.until_state(|s| *s == at_limit()).await;
    assert_eq!(bounded(p.engine.continue_analysis()).await, Ok(()));
    p.until_state(|s| *s == ready()).await;
    assert_eq!(
        bounded(p.engine.set_files(Some(files("normal")), None)).await,
        Ok(())
    );
    // Without the raised target, 315 visits are at the limit again.
    let seen = p.until_state(is_ready).await;
    assert_eq!(states(&seen).last(), Some(&&at_limit()));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn resume_carries_previous_visits() {
    let mut p = start(Some(files("slow")), p1());
    p.until_state(|s| *s == analysing()).await;
    let mut deepest = 0;
    while deepest == 0 {
        deepest = deepest.max(p.next_analysis().await.root_visits);
    }
    assert_eq!(bounded(p.engine.pause()).await, Ok(()));
    p.until_state(|s| *s == paused()).await;
    // Let the terminated query's partial final reach the cache.
    tokio::time::sleep(Duration::from_millis(300)).await;
    p.drain();
    assert_eq!(bounded(p.engine.resume()).await, Ok(()));
    let first = p.next_analysis().await;
    assert!(
        first.previous_visits >= deepest,
        "{} < {deepest}",
        first.previous_visits
    );
    bounded(p.engine.shutdown()).await;
}

fn rejections(events: &[EngineEvent]) -> Vec<&Rejection> {
    events
        .iter()
        .filter_map(|e| match e {
            EngineEvent::Rejected(r) => Some(r),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn a_rejected_position_is_reported() {
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == ready()).await;
    assert_eq!(bounded(p.engine.set_position(unrecorded())).await, Ok(()));
    let seen = p.until_state(is_ready).await;
    let rejected = rejections(&seen);
    assert_eq!(rejected.len(), 1, "{seen:?}");
    assert_eq!(rejected[0].position, unrecorded().key());
    assert!(!rejected[0].message.is_empty());
    assert_eq!(states(&seen).last(), Some(&&ready()));
    assert_eq!(p.engine.status().rejected.as_ref(), Some(rejected[0]));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn navigating_away_clears_the_rejection() {
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == ready()).await;
    assert_eq!(bounded(p.engine.set_position(unrecorded())).await, Ok(()));
    p.until(|e| matches!(e, EngineEvent::Rejected(_))).await;
    assert_eq!(bounded(p.engine.set_position(p1())).await, Ok(()));
    assert_eq!(p.engine.status().rejected, None);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn a_rejection_after_navigating_away_is_not_reported() {
    let mut p = start(Some(files("normal")), p1());
    p.until_state(|s| *s == ready()).await;
    assert_eq!(bounded(p.engine.set_position(unrecorded())).await, Ok(()));
    assert_eq!(bounded(p.engine.set_position(p2())).await, Ok(()));
    p.drain();
    let after = p.until_final().await;
    assert!(rejections(&after).is_empty(), "{after:?}");
    assert_eq!(p.engine.status().rejected, None);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn summaries_read_the_cache_in_order() {
    let mut p = start(Some(files("normal")), p1());
    let seen = p.until_final().await;
    let last = *updates(&seen).last().unwrap();
    let got = bounded(p.engine.summaries(vec![p2().key(), p1().key()])).await;
    assert_eq!(
        got,
        vec![
            None,
            Some(TrendStats {
                winrate: last.winrate,
                score_lead: last.score_lead,
                visits: last.root_visits,
            })
        ]
    );
    bounded(p.engine.shutdown()).await;
}

/// The move played next is shown whenever KataGo reported it (M7 design 5.6), however low its
/// order, so the engine must not cut the list below a full board's moves.
#[test]
fn default_options_keep_every_candidate_katago_reports() {
    assert!(EngineOptions::default().max_candidates > 19 * 19);
}

/// The positional-superko repeat recorded in `analysis-ownership.jsonl`: a ko taken back after
/// two passes, under Tromp-Taylor rules.
fn superko_repeat() -> Position {
    let mut p = Position::empty(
        BoardSize::NINETEEN,
        Rules::TrompTaylor,
        Komi::new(7.5).unwrap(),
    );
    let at = |s: &str| aji_core::move_from_gtp(s, BoardSize::NINETEEN).unwrap();
    let mut color = Color::Black;
    for s in [
        "E12", "F12", "D11", "E11", "E10", "G11", "Q4", "F10", "F11", "pass", "pass", "E11",
    ] {
        p.moves.push((color, at(s)));
        color = color.opponent();
    }
    p
}

#[tokio::test]
async fn real_katago_accepts_a_superko_repeat_as_recorded() {
    // M7 minor 11: KataGo 1.18.2's analysis engine analyses a positional-superko repeat rather
    // than refusing it, so Aji shows its analysis and reports no rejection.
    let mut p = start(Some(files("ownership")), superko_repeat());
    let seen = p.until_final().await;
    assert!(rejections(&seen).is_empty(), "{seen:?}");
    let fin = updates(&seen).into_iter().last().unwrap().clone();
    assert_eq!(fin.position, superko_repeat().key());
    assert!(!fin.candidates.is_empty());
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn engine_updates_carry_ownership() {
    let mut p = start(Some(files("ownership")), position(&[(Color::Black, 15, 3)]));
    let seen = p.until_final().await;
    let fin = updates(&seen).into_iter().last().unwrap().clone();
    let own = fin.ownership.expect("ownership");
    assert_eq!(own.len(), 361);
    assert!(own[3 * 19 + 15] > 76, "Black's Q16 is Black's");
    bounded(p.engine.shutdown()).await;
}

// ------------------------------------------------------------ the store (P2 M2)

fn identity(n: u8) -> EngineIdentity {
    EngineIdentity {
        network: [n; 32],
        config: 1,
    }
}

/// A position the fake has no recording for, so the synthetic scenarios answer it.
fn anywhere(n: u8) -> Position {
    position(&[(Color::Black, n % 19, 9 + n / 19)])
}

fn start_stored(
    name: &str,
    position: Position,
    options: EngineOptions,
    store: Store,
    id: EngineIdentity,
) -> Probe {
    let (tx, events) = unbounded_channel();
    let engine = Engine::spawn_with_store(
        Some(files(name)),
        Some(id),
        position,
        options,
        Some(store),
        move |event| {
            let _ = tx.send(event);
        },
    );
    Probe { engine, events }
}

fn memory_store() -> Store {
    Store::in_memory(1 << 30, None)
}

fn stored(events: &[EngineEvent]) -> Vec<(aji_core::PositionKey, TrendStats)> {
    events
        .iter()
        .filter_map(|e| match e {
            EngineEvent::Stored { key, stats } => Some((*key, *stats)),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn a_restart_of_aji_shows_the_stored_result_without_searching() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("analysis.sqlite");
    {
        let store = Store::open(path.clone(), 1 << 30);
        let mut p = start_stored("synthetic", anywhere(1), capped(50), store, identity(1));
        p.until_state(|s| *s == at_limit()).await;
        bounded(p.engine.shutdown()).await;
    }
    let store = Store::open(path, 1 << 30);
    let mut p = start_stored("synthetic", anywhere(1), capped(50), store, identity(1));
    let seen = p.until_state(|s| *s == at_limit()).await;
    let shown = updates(&seen);
    assert_eq!(shown.len(), 1, "{seen:?}");
    assert_eq!((shown[0].root_visits, shown[0].is_final), (50, true));
    assert_eq!(
        shown[0].previous_visits, 0,
        "a cached update is not a search"
    );
    assert!(
        states(&seen)
            .iter()
            .all(|s| !matches!(s, EngineState::Analysing { .. })),
        "{seen:?}"
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn another_identity_searches_again() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("analysis.sqlite");
    {
        let store = Store::open(path.clone(), 1 << 30);
        let mut p = start_stored("synthetic", anywhere(2), capped(50), store, identity(1));
        p.until_state(|s| *s == at_limit()).await;
        bounded(p.engine.shutdown()).await;
    }
    let store = Store::open(path, 1 << 30);
    let mut p = start_stored("synthetic", anywhere(2), capped(50), store, identity(2));
    let seen = p.until_state(|s| *s == at_limit()).await;
    assert!(states(&seen).contains(&&analysing()), "{seen:?}");
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn next_result_comes_with_the_update_once_known() {
    let a = anywhere(3);
    let mut b = a.clone();
    let reply = Move::Play(Point { x: 15, y: 15 });
    b.moves.push((Color::White, reply));
    let mut p = start_stored(
        "synthetic",
        a.clone(),
        capped(50),
        memory_store(),
        identity(1),
    );
    p.until_state(|s| *s == at_limit()).await;
    // Not yet known: no next result.
    assert_eq!(
        bounded(
            p.engine
                .set_position_next(a.clone(), Some((b.clone(), reply)))
        )
        .await,
        Ok(())
    );
    let shown = p.next_analysis().await;
    assert_eq!(shown.next, None);
    assert_eq!(bounded(p.engine.set_position(b.clone())).await, Ok(()));
    let seen = p.until_state(|s| *s == at_limit()).await;
    let after = updates(&seen).into_iter().last().unwrap().clone();
    assert_eq!(
        bounded(p.engine.set_position_next(a.clone(), Some((b, reply)))).await,
        Ok(())
    );
    let shown = p.next_analysis().await;
    let after_stats = TrendStats::of(&after);
    assert_eq!(
        shown.next,
        Some(NextResult {
            stats: after_stats,
            loss: move_loss(&TrendStats::of(&shown), &after_stats, Color::White),
        })
    );
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn stored_events_fire_for_better_rows_only() {
    let mut p = start_stored(
        "synthetic",
        anywhere(4),
        capped(50),
        memory_store(),
        identity(1),
    );
    let seen = p.until_state(|s| *s == at_limit()).await;
    let rows = stored(&seen);
    assert!(!rows.is_empty(), "{seen:?}");
    assert!(rows.iter().all(|(k, _)| *k == anywhere(4).key()));
    assert!(rows.windows(2).all(|w| w[1].1.visits >= w[0].1.visits));
    // Showing a known result again stores nothing.
    assert_eq!(bounded(p.engine.set_position(anywhere(5))).await, Ok(()));
    p.until_state(|s| *s == at_limit()).await;
    assert_eq!(bounded(p.engine.set_position(anywhere(4))).await, Ok(()));
    let again = p.collect_for(Duration::from_millis(300)).await;
    assert!(stored(&again).is_empty(), "{again:?}");
    bounded(p.engine.shutdown()).await;
}

fn imported_row(position: &Position, visits: u32) -> Row {
    Row {
        update: AnalysisUpdate {
            position: position.key(),
            board_size: 19,
            root_visits: visits,
            winrate: 0.42,
            score_lead: -1.5,
            is_final: false,
            candidates: Vec::new(),
            previous_visits: 0,
            ownership: None,
            next: None,
        },
        imported: true,
        katago_version: String::new(),
    }
}

#[tokio::test]
async fn a_progress_report_does_not_replace_an_imported_row() {
    let mut p = start_stored(
        "synthetic",
        anywhere(6),
        options(),
        memory_store(),
        identity(1),
    );
    p.until_state(|s| *s == analysing()).await;
    bounded(p.engine.import(vec![imported_row(&anywhere(7), 10_000)])).await;
    assert_eq!(bounded(p.engine.set_position(anywhere(7))).await, Ok(()));
    let first = p.next_analysis().await;
    assert_eq!(
        first.root_visits, 10_000,
        "the imported row is shown at once"
    );
    p.collect_for(Duration::from_millis(300)).await;
    let kept = bounded(p.engine.summaries(vec![anywhere(7).key()])).await;
    assert_eq!(kept[0].map(|s| s.visits), Some(10_000));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn clearing_the_current_position_restarts_its_search() {
    let mut p = start_stored(
        "synthetic",
        anywhere(8),
        capped(50),
        memory_store(),
        identity(1),
    );
    p.until_state(|s| *s == at_limit()).await;
    bounded(p.engine.clear(ClearScope::Keys(vec![anywhere(8).key()]))).await;
    let seen = p.until_state(|s| *s == at_limit()).await;
    assert!(states(&seen).contains(&&analysing()), "{seen:?}");
    assert!(updates(&seen).iter().any(|u| u.is_final));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn continue_analysis_resubmits_while_a_query_is_in_flight() {
    // M7 minor 2.
    let mut p = start_stored(
        "synthetic-slow",
        anywhere(9),
        capped(100),
        memory_store(),
        identity(1),
    );
    let first = p.next_analysis().await;
    assert!(!first.is_final);
    assert_eq!(bounded(p.engine.continue_analysis()).await, Ok(()));
    let seen = p.until_state(|s| *s == at_limit()).await;
    let fin = updates(&seen).into_iter().rfind(|u| u.is_final).unwrap();
    assert!(fin.root_visits > 100, "{}", fin.root_visits);
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn a_cached_update_has_no_previous_visits() {
    // M7 minor 12: a second search of a position stores its own previous visits; showing the
    // stored result again is not a search catching up.
    let mut p = start_stored(
        "synthetic",
        anywhere(10),
        capped(50),
        memory_store(),
        identity(1),
    );
    p.until_state(|s| *s == at_limit()).await;
    assert_eq!(bounded(p.engine.continue_analysis()).await, Ok(()));
    let seen = p.until_state(|s| *s == at_limit()).await;
    let fin = updates(&seen)
        .into_iter()
        .rfind(|u| u.is_final)
        .unwrap()
        .clone();
    assert_eq!(fin.previous_visits, 50);
    assert_eq!(bounded(p.engine.set_position(anywhere(11))).await, Ok(()));
    p.until_state(|s| *s == at_limit()).await;
    assert_eq!(bounded(p.engine.set_position(anywhere(10))).await, Ok(()));
    let shown = p.next_analysis().await;
    assert_eq!((shown.root_visits, shown.previous_visits), (100, 0));
    bounded(p.engine.shutdown()).await;
}

#[tokio::test]
async fn a_burst_of_30_positions_in_300ms_sends_at_most_4_queries() {
    // M7 minor 11.
    let mut p = start_with(Some(files("synthetic")), anywhere(0), gated(100));
    p.until_state(|s| *s == analysing()).await;
    let before = p.engine.queries_sent();
    let begun = Instant::now();
    for n in 1..=30 {
        assert_eq!(bounded(p.engine.set_position(anywhere(n))).await, Ok(()));
        tokio::time::sleep(Duration::from_millis(9)).await;
    }
    assert!(begun.elapsed() < Duration::from_millis(400));
    tokio::time::sleep(Duration::from_millis(150)).await;
    let sent = p.engine.queries_sent() - before;
    assert!((1..=4).contains(&sent), "{sent} queries");
    bounded(p.engine.shutdown()).await;
}
