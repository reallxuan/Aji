//! `run_benchmark` against the fake KataGo in install mode: results, a classified failure and a
//! stall.

mod common;

use std::time::Duration;

use std::collections::BTreeMap;

use aji_manager::install::{
    BenchmarkPlan, FailureCode, analysis_config, benchmark_config, run_benchmark, run_test_query,
};
use common::fake::{BENCHMARK_CONFIG, install, transcript};
use serde_json::json;
use tokio::time::Instant;

fn plan() -> BenchmarkPlan {
    BenchmarkPlan {
        visits: 100,
        positions: 5,
        threads: vec![8, 16],
    }
}

const SPEEDS: &str = r#"{ "8": 100.0, "16": 180.0 }"#;

#[tokio::test]
async fn the_benchmark_reports_each_thread_count() {
    let speeds: serde_json::Value = serde_json::from_str(SPEEDS).unwrap();
    let scenario = json!({ "benchmark": { "visitsPerSecond": speeds } });
    let (_dir, files) = install(&scenario, BENCHMARK_CONFIG);
    let result = run_benchmark(&files, &plan(), Duration::from_secs(10), &mut |_| {})
        .await
        .unwrap();
    let pairs: Vec<(u32, f64)> = result
        .iter()
        .map(|s| (s.threads, s.visits_per_second))
        .collect();
    assert_eq!(pairs, [(8, 100.0), (16, 180.0)]);
}

#[tokio::test]
async fn a_failed_benchmark_is_classified() {
    let line = "ERROR: NN server thread failed: CUDA Error, for ScratchBuffers file cudaandrocmbackend.inc, func ScratchBuffers, line 868, error out of memory";
    let speeds: serde_json::Value = serde_json::from_str(SPEEDS).unwrap();
    let scenario = json!({
        "benchmark": { "visitsPerSecond": speeds },
        "failure": { "during": "benchmark", "stderr": [line], "exitCode": 3 }
    });
    let (_dir, files) = install(&scenario, BENCHMARK_CONFIG);
    let failure = run_benchmark(&files, &plan(), Duration::from_secs(10), &mut |_| {})
        .await
        .unwrap_err();
    assert_eq!(failure.code, FailureCode::OutOfMemory);
    assert!(failure.stderr_tail.iter().any(|l| l == line), "{failure:?}");
    // stdout's last lines follow stderr's, where `benchmark` logs.
    assert!(
        failure
            .stderr_tail
            .iter()
            .any(|l| l.starts_with("Testing different numbers of threads")),
        "{failure:?}"
    );
}

#[tokio::test]
async fn a_config_error_is_crashed() {
    let speeds: serde_json::Value = serde_json::from_str(SPEEDS).unwrap();
    let scenario = json!({ "benchmark": { "visitsPerSecond": speeds } });
    let (_dir, files) = install(&scenario, "nnMaxBatchSize = 8\n");
    let failure = run_benchmark(&files, &plan(), Duration::from_secs(10), &mut |_| {})
        .await
        .unwrap_err();
    assert_eq!(failure.code, FailureCode::Crashed);
    assert!(
        failure
            .stderr_tail
            .iter()
            .any(|l| l.contains("Could not find key 'numSearchThreads'")),
        "{failure:?}"
    );
}

#[tokio::test]
async fn a_stalled_benchmark_times_out() {
    let (_dir, files) = install(&json!({ "hang": true }), BENCHMARK_CONFIG);
    let started = Instant::now();
    let failure = run_benchmark(&files, &plan(), Duration::from_millis(500), &mut |_| {})
        .await
        .unwrap_err();
    assert_eq!(failure.code, FailureCode::TimedOut);
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

/// The configs Aji writes pass KataGo's own rules, which the fake enforces with KataGo's
/// messages: `benchmark` needs `numSearchThreads`; the analysis engine needs its three keys and
/// refuses `numSearchThreads` beside `numSearchThreadsPerAnalysisThread`.
#[tokio::test]
async fn the_generated_configs_pass_katagos_rules() {
    let none = BTreeMap::new();
    let speeds: serde_json::Value = serde_json::from_str(SPEEDS).unwrap();
    let scenario = json!({ "benchmark": { "visitsPerSecond": speeds } });
    let (_dir, files) = install(&scenario, &benchmark_config(&plan(), &none));
    let result = run_benchmark(&files, &plan(), Duration::from_secs(10), &mut |_| {}).await;
    assert!(result.is_ok(), "{result:?}");

    let scenario = json!({ "transcript": transcript() });
    let (_dir, files) = install(&scenario, &analysis_config(8, &none));
    let result = run_test_query(files, Duration::from_secs(20)).await;
    assert_eq!(result, Ok(()));
}
