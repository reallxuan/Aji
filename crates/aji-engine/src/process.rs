//! Launching KataGo: its command line, the spawner thread, the per-OS measures that keep
//! KataGo from outliving Aji, and the tasks that read and write its pipes.
//!
//! - Windows: KataGo is created without a console window and put in a job object that
//!   kills it when Aji's handle to the job closes, which includes Aji being killed.
//! - Linux: KataGo asks for `SIGKILL` when its parent dies. The kernel sends it when the
//!   spawning *thread* exits, so every spawn runs on one thread that lives as long as
//!   the process.
//! - macOS: nothing extra. KataGo is launched with `-quit-without-waiting` and exits on
//!   stdin EOF, which the kernel delivers when Aji dies.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io;
use std::panic::{self, AssertUnwindSafe};
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, mpsc};
use std::thread;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::runtime::Handle;
use tokio::sync::{mpsc as tokio_mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::state::ExitInfo;

/// Where KataGo and its files are. KataGo resolves a relative `model` or `config` against
/// `working_dir`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineFiles {
    pub katago: PathBuf,
    pub model: PathBuf,
    pub config: PathBuf,
    pub working_dir: PathBuf,
    /// Folders put before the inherited `PATH`, for the runtime libraries KataGo loads (the
    /// NVIDIA DLLs on Windows). Only KataGo's own environment changes, never the system's.
    pub path_prepend: Vec<PathBuf>,
}

/// A program, its arguments, its working directory and the variables set in its environment
/// on top of the inherited ones.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub working_dir: PathBuf,
    pub env: Vec<(OsString, OsString)>,
}

/// KataGo's analysis engine command line. Aji always forces `-quit-without-waiting`, Black's
/// point of view for winrates and scores, and logging to stderr.
pub fn katago_launch(files: &EngineFiles) -> LaunchSpec {
    let args = vec![
        OsString::from("analysis"),
        OsString::from("-config"),
        files.config.clone().into_os_string(),
        OsString::from("-model"),
        files.model.clone().into_os_string(),
        OsString::from("-quit-without-waiting"),
        OsString::from("-override-config"),
        OsString::from("reportAnalysisWinratesAs=BLACK,logToStderr=true"),
    ];
    LaunchSpec {
        program: files.katago.clone(),
        args,
        working_dir: files.working_dir.clone(),
        env: runtime_path(&files.path_prepend)
            .map(|path| (OsString::from("PATH"), path))
            .into_iter()
            .collect(),
    }
}

/// KataGo's `benchmark` command line: `visits` per search over `positions` positions, once per
/// thread count. KataGo's extra tests after the main run (half batch size, two server
/// threads) are skipped. The runtime folders go on `PATH` as for [`katago_launch`].
pub fn katago_benchmark_launch(
    files: &EngineFiles,
    visits: u32,
    positions: u32,
    threads: &[u32],
) -> LaunchSpec {
    let threads = threads
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let mut args = vec![
        OsString::from("benchmark"),
        OsString::from("-config"),
        files.config.clone().into_os_string(),
        OsString::from("-model"),
        files.model.clone().into_os_string(),
    ];
    for (flag, value) in [
        ("-v", visits.to_string()),
        ("-n", positions.to_string()),
        ("-t", threads),
    ] {
        args.push(OsString::from(flag));
        args.push(OsString::from(value));
    }
    args.push(OsString::from("-no-server-thread-test"));
    args.push(OsString::from("-no-half-batch-size-test"));
    LaunchSpec {
        args,
        ..katago_launch(files)
    }
}

/// `PATH` with `prepend` before the inherited entries, or `None` when there is nothing to add.
/// An unset or empty inherited `PATH` adds no empty entry, which Unix would read as the
/// current folder. A folder that cannot go in a `PATH` (the list separator on Unix, a quote
/// on Windows) is logged and the change dropped: KataGo then fails to load its runtime, which
/// is reported like any start-up failure.
fn runtime_path(prepend: &[PathBuf]) -> Option<OsString> {
    if prepend.is_empty() {
        return None;
    }
    let inherited = std::env::var_os("PATH").filter(|path| !path.is_empty());
    let inherited = inherited.iter().flat_map(std::env::split_paths);
    match std::env::join_paths(prepend.iter().cloned().chain(inherited)) {
        Ok(path) => Some(path),
        Err(e) => {
            eprintln!("aji: cannot put the runtime folders on PATH: {e}");
            None
        }
    }
}

/// How long to wait for the pipe readers to reach EOF once the process has exited.
const DRAIN_AFTER_EXIT: Duration = Duration::from_secs(1);

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

// ------------------------------------------------------------------ spawning

/// A KataGo process with its pipes taken out.
pub(crate) struct Spawned {
    pub(crate) process: KataProcess,
    pub(crate) pid: u32,
    pub(crate) stdin: ChildStdin,
    pub(crate) stdout: ChildStdout,
    pub(crate) stderr: ChildStderr,
}

/// The child process. Dropping it kills the process.
pub(crate) struct KataProcess {
    child: Child,
    /// Lives exactly as long as the process handle; closing it kills the process.
    #[cfg(windows)]
    _job: windows::Job,
}

type SpawnDone = Box<dyn FnOnce(io::Result<Spawned>) + Send>;

struct SpawnRequest {
    spec: LaunchSpec,
    runtime: Handle,
    done: SpawnDone,
}

static SPAWNER: Mutex<Option<mpsc::Sender<SpawnRequest>>> = Mutex::new(None);

/// Spawns KataGo on the `aji-engine-spawner` thread, inside `runtime`, and calls `done`
/// with the result on that thread.
pub(crate) fn request_spawn(
    spec: LaunchSpec,
    runtime: Handle,
    done: impl FnOnce(io::Result<Spawned>) + Send + 'static,
) {
    let request = SpawnRequest {
        spec,
        runtime,
        done: Box::new(done),
    };
    match spawner() {
        Ok(tx) => {
            if let Err(mpsc::SendError(request)) = tx.send(request) {
                (request.done)(Err(io::Error::other("the spawner thread has stopped")));
            }
        }
        Err(e) => (request.done)(Err(e)),
    }
}

/// The sender to the spawner thread, starting the thread on first use.
fn spawner() -> io::Result<mpsc::Sender<SpawnRequest>> {
    let mut slot = lock(&SPAWNER);
    if let Some(tx) = slot.as_ref() {
        return Ok(tx.clone());
    }
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("aji-engine-spawner".into())
        .spawn(move || serve(rx))?;
    *slot = Some(tx.clone());
    Ok(tx)
}

/// The spawner thread. It never returns: `SPAWNER` holds a sender for the whole process.
fn serve(requests: mpsc::Receiver<SpawnRequest>) {
    for SpawnRequest {
        spec,
        runtime,
        done,
    } in requests
    {
        // Tokio registers the child and its pipes with the runtime that is entered here.
        let _entered = runtime.enter();
        let result = panic::catch_unwind(AssertUnwindSafe(|| spawn_now(&spec)))
            .unwrap_or_else(|_| Err(io::Error::other("spawning KataGo panicked")));
        // A panic in `done` must not end this thread either.
        let _ = panic::catch_unwind(AssertUnwindSafe(move || done(result)));
    }
}

fn spawn_now(spec: &LaunchSpec) -> io::Result<Spawned> {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .envs(spec.env.iter().map(|(key, value)| (key, value)))
        .current_dir(&spec.working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    harden(&mut command);
    let mut child = command.spawn()?;
    #[cfg(windows)]
    let job = windows::contain(&child)?;
    let missing = || io::Error::other("KataGo's pipes were not created");
    let pid = child
        .id()
        .ok_or_else(|| io::Error::other("KataGo exited while starting"))?;
    let stdin = child.stdin.take().ok_or_else(missing)?;
    let stdout = child.stdout.take().ok_or_else(missing)?;
    let stderr = child.stderr.take().ok_or_else(missing)?;
    Ok(Spawned {
        process: KataProcess {
            child,
            #[cfg(windows)]
            _job: job,
        },
        pid,
        stdin,
        stdout,
        stderr,
    })
}

#[cfg(target_os = "linux")]
fn harden(command: &mut Command) {
    // SAFETY: `getpid` has no preconditions.
    let spawner = unsafe { libc::getpid() };
    let hook = move || {
        // SAFETY: runs in the child between fork and exec, and calls only async-signal-safe
        // functions. `prctl` is variadic, so the signal is passed as the `unsigned long`
        // it reads.
        if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // The parent may have died before the signal was armed.
        // SAFETY: as above.
        if unsafe { libc::getppid() } != spawner {
            unsafe { libc::_exit(1) };
        }
        Ok(())
    };
    // SAFETY: the hook is async-signal-safe (see above).
    unsafe {
        command.pre_exec(hook);
    }
}

#[cfg(windows)]
fn harden(command: &mut Command) {
    command.creation_flags(windows::CREATE_NO_WINDOW);
}

#[cfg(not(any(target_os = "linux", windows)))]
fn harden(_command: &mut Command) {}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::ptr;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    pub(super) const CREATE_NO_WINDOW: u32 =
        windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    /// A job object that kills every process in it when its last handle closes.
    pub(super) struct Job(HANDLE);

    // SAFETY: a job handle is a kernel handle that any thread may use or close.
    unsafe impl Send for Job {}

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle came from `CreateJobObjectW` and is closed only here.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Puts `child` in a new kill-on-close job.
    pub(super) fn contain(child: &tokio::process::Child) -> io::Result<Job> {
        let process = child
            .raw_handle()
            .ok_or_else(|| io::Error::other("KataGo exited while starting"))?;
        // SAFETY: null attributes and name are allowed; the handle is owned by `Job`.
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Job(handle);
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `info` is the structure that `JobObjectExtendedLimitInformation` names,
        // with its exact size.
        let set = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                ptr::from_ref(&info).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if set == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: both handles are valid; the process handle is owned by `child`.
        if unsafe { AssignProcessToJobObject(job.0, process) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }
}

// ------------------------------------------------------------- one-shot runs

/// How long a one-shot run may stay silent, and how much of its stderr is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunLimits {
    /// No byte on stdout or stderr for this long kills the process.
    pub stall: Duration,
    /// Lines of stderr kept, the last ones.
    pub stderr_lines: usize,
}

/// What a one-shot run left behind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutput {
    pub exit: ExitInfo,
    /// Everything on stdout, as lossy UTF-8, `\r` kept; at most the last [`MAX_RUN_STDOUT`]
    /// bytes.
    pub stdout: String,
    pub stderr_tail: Vec<String>,
    /// Killed for staying silent longer than [`RunLimits::stall`].
    pub stalled: bool,
}

/// The most of a run's stdout kept. A benchmark prints a few kilobytes.
pub const MAX_RUN_STDOUT: usize = 1024 * 1024;
/// How long a killed one-shot process has to exit before it is given up.
const RUN_KILL_DEADLINE: Duration = Duration::from_secs(5);
/// A spawn failing with "Text file busy" is retried this many times, this far apart: on Linux
/// a binary written just before can be held open for a moment by another thread's fork.
const BUSY_RETRIES: u32 = 3;
const BUSY_PAUSE: Duration = Duration::from_millis(100);

/// Runs `spec` to its end through the spawner thread (job object, parent-death signal), with
/// stdin closed. Reads raw bytes, since KataGo's benchmark progress uses `\r`. No bytes on
/// stdout or stderr for `limits.stall` kills the process and sets `stalled`. Dropping the
/// future kills the process.
pub async fn run_to_end(spec: LaunchSpec, limits: RunLimits) -> io::Result<RunOutput> {
    run_to_end_watching(spec, limits, &mut |_| {}).await
}

/// [`run_to_end`], passing each piece of stdout to `on_stdout` as it arrives, for progress.
pub async fn run_to_end_watching(
    spec: LaunchSpec,
    limits: RunLimits,
    on_stdout: &mut (dyn FnMut(&[u8]) + Send),
) -> io::Result<RunOutput> {
    let spawned = retry_busy(|| spawn_here(spec.clone())).await?;
    let Spawned {
        mut process,
        stdin,
        mut stdout,
        mut stderr,
        ..
    } = spawned;
    drop(stdin);

    let mut out = Vec::new();
    let mut err = LineTail::new(limits.stderr_lines);
    let (mut out_open, mut err_open) = (true, true);
    let (mut out_buf, mut err_buf) = ([0u8; 8192], [0u8; 8192]);
    let mut stalled = false;
    let mut quiet_until = tokio::time::Instant::now() + limits.stall;
    let status = loop {
        tokio::select! {
            read = stdout.read(&mut out_buf), if out_open => match read {
                Ok(n) if n > 0 => {
                    on_stdout(&out_buf[..n]);
                    keep_last(&mut out, &out_buf[..n], MAX_RUN_STDOUT);
                    quiet_until = tokio::time::Instant::now() + limits.stall;
                }
                _ => out_open = false,
            },
            read = stderr.read(&mut err_buf), if err_open => match read {
                Ok(n) if n > 0 => {
                    err.push(&err_buf[..n]);
                    quiet_until = tokio::time::Instant::now() + limits.stall;
                }
                _ => err_open = false,
            },
            status = process.child.wait() => break status,
            () = tokio::time::sleep_until(quiet_until) => {
                stalled = true;
                let _ = process.child.start_kill();
                break tokio::time::timeout(RUN_KILL_DEADLINE, process.child.wait())
                    .await
                    .unwrap_or_else(|_| Err(io::Error::other("KataGo did not exit after kill")));
            }
        }
    };
    // What is still in the pipes, for a bounded time: a grandchild may hold them open.
    let _ = tokio::time::timeout(DRAIN_AFTER_EXIT, async {
        while out_open || err_open {
            tokio::select! {
                read = stdout.read(&mut out_buf), if out_open => match read {
                    Ok(n) if n > 0 => {
                        on_stdout(&out_buf[..n]);
                        keep_last(&mut out, &out_buf[..n], MAX_RUN_STDOUT);
                    }
                    _ => out_open = false,
                },
                read = stderr.read(&mut err_buf), if err_open => match read {
                    Ok(n) if n > 0 => err.push(&err_buf[..n]),
                    _ => err_open = false,
                },
            }
        }
    })
    .await;
    Ok(RunOutput {
        exit: exit_info(status),
        stdout: String::from_utf8_lossy(&out).into_owned(),
        stderr_tail: err.finish(),
        stalled,
    })
}

/// Spawns on the spawner thread, inside the current runtime, and waits for the result. If
/// this future is dropped first, the spawned process is dropped with the result, which kills
/// it.
async fn spawn_here(spec: LaunchSpec) -> io::Result<Spawned> {
    let (tx, rx) = oneshot::channel();
    request_spawn(spec, Handle::current(), move |result| {
        let _ = tx.send(result);
    });
    rx.await
        .unwrap_or_else(|_| Err(io::Error::other("the spawner thread dropped the request")))
}

/// Runs `attempt` again while it fails with "Text file busy", up to [`BUSY_RETRIES`] times.
pub(crate) async fn retry_busy<T, F, Fut>(mut attempt: F) -> io::Result<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = io::Result<T>>,
{
    let mut retries = 0;
    loop {
        match attempt().await {
            Err(e) if e.kind() == io::ErrorKind::ExecutableFileBusy && retries < BUSY_RETRIES => {
                retries += 1;
                tokio::time::sleep(BUSY_PAUSE).await;
            }
            result => return result,
        }
    }
}

/// Appends `bytes`, keeping only the last `max` bytes.
fn keep_last(buf: &mut Vec<u8>, bytes: &[u8], max: usize) {
    buf.extend_from_slice(bytes);
    if buf.len() > max {
        buf.drain(..buf.len() - max);
    }
}

/// The last lines of a byte stream, split on `\n`, without line endings.
struct LineTail {
    keep: usize,
    lines: VecDeque<String>,
    partial: Vec<u8>,
}

impl LineTail {
    fn new(keep: usize) -> LineTail {
        LineTail {
            keep,
            lines: VecDeque::new(),
            partial: Vec::new(),
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if byte == b'\n' {
                let line = std::mem::take(&mut self.partial);
                self.add(line);
            } else {
                self.partial.push(byte);
            }
        }
    }

    fn add(&mut self, mut line: Vec<u8>) {
        while line.last() == Some(&b'\r') {
            line.pop();
        }
        if self.keep == 0 {
            return;
        }
        if self.lines.len() >= self.keep {
            self.lines.pop_front();
        }
        self.lines
            .push_back(String::from_utf8_lossy(&line).into_owned());
    }

    fn finish(mut self) -> Vec<String> {
        if !self.partial.is_empty() {
            let line = std::mem::take(&mut self.partial);
            self.add(line);
        }
        self.lines.into()
    }
}

// --------------------------------------------------------------------- pipes

/// The last lines KataGo wrote to stderr, oldest first.
pub(crate) type StderrTail = Arc<Mutex<VecDeque<String>>>;

/// Reads `reader` as lines of lossy UTF-8, without line endings, until EOF, a read error,
/// or `on_line` returning `false`.
pub(crate) async fn read_lines<R: AsyncRead + Unpin>(
    reader: R,
    mut on_line: impl FnMut(String) -> bool,
) {
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        while matches!(buf.last(), Some(b'\n' | b'\r')) {
            buf.pop();
        }
        if !on_line(String::from_utf8_lossy(&buf).into_owned()) {
            return;
        }
    }
}

/// Drains stderr continuously, keeping its last `keep` lines in `tail`. A pipe nobody reads
/// would eventually block KataGo.
pub(crate) async fn keep_stderr_tail(stderr: ChildStderr, keep: usize, tail: StderrTail) {
    read_lines(stderr, |line| {
        if keep > 0 {
            let mut tail = lock(&tail);
            if tail.len() >= keep {
                tail.pop_front();
            }
            tail.push_back(line);
        }
        true
    })
    .await;
}

/// Writes each line from `lines` to KataGo's stdin. Ends, closing stdin, when the channel
/// closes or a write fails.
pub(crate) async fn write_lines(
    mut stdin: ChildStdin,
    mut lines: tokio_mpsc::UnboundedReceiver<String>,
) {
    while let Some(mut line) = lines.recv().await {
        line.push('\n');
        if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
            return;
        }
    }
}

/// Waits for `process` to exit, killing it if `kill` fires or is dropped, then lets the pipe
/// readers reach EOF (for a bounded time) so the stderr tail is complete.
pub(crate) async fn supervise(
    mut process: KataProcess,
    kill: oneshot::Receiver<()>,
    readers: Vec<JoinHandle<()>>,
    tail: StderrTail,
) -> (ExitInfo, Vec<String>) {
    let status = tokio::select! {
        status = process.child.wait() => status,
        _ = kill => {
            let _ = process.child.start_kill();
            process.child.wait().await
        }
    };
    let _ = tokio::time::timeout(DRAIN_AFTER_EXIT, async {
        for reader in readers {
            let _ = reader.await;
        }
    })
    .await;
    let tail = lock(&tail).iter().cloned().collect();
    (exit_info(status), tail)
}

fn exit_info(status: io::Result<ExitStatus>) -> ExitInfo {
    match status {
        Ok(status) => ExitInfo {
            code: status.code(),
            signal: signal(&status),
        },
        Err(_) => ExitInfo {
            code: None,
            signal: None,
        },
    }
}

#[cfg(unix)]
fn signal(status: &ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn signal(_status: &ExitStatus) -> Option<i32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lines_are_lossy_and_lose_their_endings() {
        let input: &[u8] = b"one\r\ntw\xffo\n\nlast";
        let mut lines = Vec::new();
        read_lines(input, |l| {
            lines.push(l);
            true
        })
        .await;
        assert_eq!(lines, ["one", "tw\u{fffd}o", "", "last"]);
    }

    #[tokio::test]
    async fn busy_spawns_are_retried() {
        let mut calls = 0;
        let result = retry_busy(|| {
            calls += 1;
            let busy = calls < 3;
            async move {
                if busy {
                    Err(io::Error::from(io::ErrorKind::ExecutableFileBusy))
                } else {
                    Ok(calls)
                }
            }
        })
        .await;
        assert_eq!(result.unwrap(), 3);

        let mut calls = 0;
        let result: io::Result<()> = retry_busy(|| {
            calls += 1;
            async { Err(io::Error::from(io::ErrorKind::ExecutableFileBusy)) }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(calls, 1 + BUSY_RETRIES, "three retries, then the error");

        let mut calls = 0;
        let result: io::Result<()> = retry_busy(|| {
            calls += 1;
            async { Err(io::Error::from(io::ErrorKind::NotFound)) }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(calls, 1, "only a busy binary is retried");
    }

    #[test]
    fn the_stderr_tail_keeps_the_last_lines() {
        let mut tail = LineTail::new(2);
        tail.push(b"one\r\ntwo\nthr");
        tail.push(b"ee\nfour");
        assert_eq!(tail.finish(), ["three", "four"]);
    }

    #[test]
    fn stdout_keeps_its_last_bytes() {
        let mut out = b"abc".to_vec();
        keep_last(&mut out, b"defg", 5);
        assert_eq!(out, b"cdefg");
    }

    fn files(path_prepend: Vec<PathBuf>) -> EngineFiles {
        EngineFiles {
            katago: PathBuf::from("katago"),
            model: PathBuf::from("model.bin.gz"),
            config: PathBuf::from("analysis.cfg"),
            working_dir: PathBuf::from("."),
            path_prepend,
        }
    }

    #[test]
    fn path_prepend_goes_before_the_inherited_path() {
        let (a, b) = (PathBuf::from("runtime-a"), PathBuf::from("runtime-b"));
        let spec = katago_launch(&files(vec![a.clone(), b.clone()]));
        let inherited = std::env::var_os("PATH").unwrap_or_default();
        let want =
            std::env::join_paths([a, b].into_iter().chain(std::env::split_paths(&inherited)))
                .unwrap();
        assert_eq!(spec.env, vec![(OsString::from("PATH"), want)]);
    }

    #[test]
    fn no_path_prepend_leaves_the_environment_alone() {
        assert!(katago_launch(&files(Vec::new())).env.is_empty());
    }
}
