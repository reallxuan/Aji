//! The install's test query against the fake KataGo in install mode, replaying the M2 Metal
//! transcript (its `p0` query is the empty 19×19 board, Chinese, 7.5; the fake matches on the
//! position, not on `maxVisits`).

mod common;

use std::time::Duration;

use aji_engine::EngineFiles;
use aji_manager::install::{FailureCode, run_test_query};
use common::fake::{ANALYSIS_CONFIG, fake_pid, install, transcript};
use serde_json::{Value, json};
use tokio::time::Instant;

/// The fake replaying the transcript, with `extra` merged into its scenario.
fn engine(extra: Value) -> (tempfile::TempDir, EngineFiles) {
    let mut scenario = json!({ "transcript": transcript() });
    for (key, value) in extra.as_object().unwrap() {
        scenario[key] = value.clone();
    }
    install(&scenario, ANALYSIS_CONFIG)
}

#[tokio::test]
async fn the_test_query_passes_when_candidates_arrive() {
    let (_dir, files) = engine(json!({}));
    let result = run_test_query(files, Duration::from_secs(20)).await;
    assert_eq!(result, Ok(()));
}

#[tokio::test]
async fn a_failure_during_the_query_is_classified() {
    let line = "ERROR: NN server thread failed: CUDA Error, for Buffers file cudaandrocmbackend.inc, func Buffers, line 4724, error out of memory";
    let (_dir, files) = engine(json!({
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
    let (dir, files) = engine(json!({ "hangAfterReady": true }));
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
    assert!(
        !common::fake::alive(pid),
        "KataGo {pid} outlived the test query"
    );
    #[cfg(not(unix))]
    let _ = pid;
}
