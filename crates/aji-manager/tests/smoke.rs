//! The install's test query against the fake KataGo in install mode, replaying the M2 Metal
//! transcript (its `p0` query is the empty 19×19 board, Chinese, 7.5; the fake matches on the
//! position, not on `maxVisits`).

use std::path::{Path, PathBuf};
use std::time::Duration;

use aji_engine::EngineFiles;
use aji_manager::install::{FailureCode, run_test_query};
use serde_json::{Value, json};
use tokio::time::Instant;

const EXE: &str = if cfg!(windows) {
    "katago.exe"
} else {
    "katago"
};

const ANALYSIS_CONFIG: &str =
    "numAnalysisThreads = 1\nnumSearchThreadsPerAnalysisThread = 8\nnnMaxBatchSize = 8\n";

fn transcript() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../aji-engine/tests/fixtures/katago/1.18.2-metal/analysis.jsonl")
        .to_string_lossy()
        .into_owned()
}

/// The fake copied into a folder of its own as an installed engine, with `extra` merged into
/// a scenario that replays the transcript.
fn install(extra: Value) -> (tempfile::TempDir, EngineFiles) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::copy(
        env!("CARGO_BIN_EXE_aji-manager-fake-katago"),
        root.join(EXE),
    )
    .unwrap();
    let mut scenario = json!({ "transcript": transcript() });
    for (key, value) in extra.as_object().unwrap() {
        scenario[key] = value.clone();
    }
    std::fs::write(
        root.join("fake-katago-scenario.json"),
        serde_json::to_vec(&scenario).unwrap(),
    )
    .unwrap();
    std::fs::write(root.join("engine.cfg"), ANALYSIS_CONFIG).unwrap();
    std::fs::write(root.join("model.bin.gz"), b"not a real network").unwrap();
    let files = EngineFiles {
        katago: root.join(EXE),
        model: "model.bin.gz".into(),
        config: "engine.cfg".into(),
        working_dir: root.to_path_buf(),
        path_prepend: Vec::new(),
    };
    (dir, files)
}

/// The pid the fake wrote beside itself.
fn fake_pid(dir: &Path) -> u32 {
    std::fs::read_to_string(dir.join("fake-katago.pid"))
        .expect("the fake started")
        .trim()
        .parse()
        .unwrap()
}

#[cfg(unix)]
fn alive(pid: u32) -> bool {
    let pid = libc::pid_t::try_from(pid).expect("pid fits pid_t");
    // SAFETY: signal 0 only checks that the process exists.
    if unsafe { libc::kill(pid, 0) } != 0 {
        return std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH);
    }
    // A zombie has exited and only waits to be reaped.
    !std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| {
        stat.rsplit_once(')')
            .is_some_and(|(_, rest)| rest.trim_start().starts_with('Z'))
    })
}

#[tokio::test]
async fn the_test_query_passes_when_candidates_arrive() {
    let (_dir, files) = install(json!({}));
    let result = run_test_query(files, Duration::from_secs(20)).await;
    assert_eq!(result, Ok(()));
}

#[tokio::test]
async fn a_failure_during_the_query_is_classified() {
    let line = "ERROR: NN server thread failed: CUDA Error, for Buffers file cudaandrocmbackend.inc, func Buffers, line 4724, error out of memory";
    let (_dir, files) = install(json!({
        "failure": { "during": "query", "stderr": [line], "exitCode": 3 }
    }));
    let failure = run_test_query(files, Duration::from_secs(20))
        .await
        .unwrap_err();
    assert_eq!(failure.code, FailureCode::OutOfMemory);
    assert!(
        failure.stderr_tail.iter().any(|l| l == line),
        "{:?}",
        failure.stderr_tail
    );
}

#[tokio::test]
async fn a_silent_engine_times_out() {
    let (dir, files) = install(json!({ "hangAfterReady": true }));
    let started = Instant::now();
    let failure = run_test_query(files, Duration::from_secs(1))
        .await
        .unwrap_err();
    assert_eq!(failure.code, FailureCode::TimedOut);
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "{:?}",
        started.elapsed()
    );
    // KataGo is gone by the time the test query returns: on Windows a running KataGo would
    // keep its folder locked for the installer's next step.
    let pid = fake_pid(dir.path());
    #[cfg(unix)]
    assert!(!alive(pid), "KataGo {pid} outlived the test query");
    #[cfg(not(unix))]
    let _ = pid;
}
