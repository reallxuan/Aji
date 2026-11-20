//! KataGo's `benchmark` over a few thread counts, and the choice among them (design 5.5).

use std::collections::BTreeMap;
use std::sync::LazyLock;
use std::time::Duration;

use aji_engine::{EngineFiles, RunLimits, katago_benchmark_launch, run_to_end};

use super::{FailureCode, StepFailure, ThreadSpeed, classify};
use crate::manifest::Backend;

/// What `benchmark` is run with: `-v`, `-n` and `-t`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BenchmarkPlan {
    pub visits: u32,
    pub positions: u32,
    /// Never empty.
    pub threads: Vec<u32>,
}

/// GPU backends: `-v 400 -n 5`, threads 6, 10, 16 on Metal and 8, 16, 32 elsewhere. CPU
/// backends: `-v 100 -n 3`, threads half the cores (at least 1) and all of them.
pub fn benchmark_plan(backend: Backend, cpu_cores: u32) -> BenchmarkPlan {
    let gpu = |threads: Vec<u32>| BenchmarkPlan {
        visits: 400,
        positions: 5,
        threads,
    };
    match backend {
        Backend::Eigen | Backend::Eigenavx2 => {
            let cores = cpu_cores.max(1);
            let mut threads = vec![(cores / 2).max(1), cores];
            threads.dedup();
            BenchmarkPlan {
                visits: 100,
                positions: 3,
                threads,
            }
        }
        Backend::Metal => gpu(vec![6, 10, 16]),
        Backend::Cuda
        | Backend::Rocm
        | Backend::Directml
        | Backend::Openvino
        | Backend::Opencl
        | Backend::Unknown => gpu(vec![8, 16, 32]),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BenchmarkParseError {
    /// No thread count finished its positions.
    NoResults,
}

/// Per thread count, the last `k / k positions, visits/s = X` line before "Running additional
/// tests" (or the end). Works for the auto-tuned, fixed-thread and truncated fixtures. Sorted
/// by thread count.
pub fn parse_benchmark(stdout: &str) -> Result<Vec<ThreadSpeed>, BenchmarkParseError> {
    // `program/playutils.cpp:834-869`: `numSearchThreads = %2d: <n> / <m> positions,
    // visits/s = %.2f …`, progress lines joined by `\r`.
    static RESULT: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"numSearchThreads\s*=\s*(\d+):\s*(\d+)\s*/\s*(\d+)\s+positions,\s*visits/s\s*=\s*(\d+(?:\.\d+)?)",
        )
        .expect("a valid pattern")
    });
    // After the main run, `benchmark` re-measures its recommendation (`benchmark.cpp:210-211`).
    let main_run = stdout
        .split("Running additional tests")
        .next()
        .unwrap_or_default();
    let mut speeds = BTreeMap::new();
    for line in main_run.split(['\n', '\r']) {
        let Some(c) = RESULT.captures(line) else {
            continue;
        };
        let number = |i: usize| c[i].parse::<u32>().ok();
        let (Some(threads), Some(done), Some(total)) = (number(1), number(2), number(3)) else {
            continue;
        };
        if total > 0
            && done == total
            && let Ok(visits_per_second) = c[4].parse::<f64>()
        {
            speeds.insert(threads, visits_per_second);
        }
    }
    if speeds.is_empty() {
        return Err(BenchmarkParseError::NoResults);
    }
    Ok(speeds
        .into_iter()
        .map(|(threads, visits_per_second)| ThreadSpeed {
            threads,
            visits_per_second,
        })
        .collect())
}

/// The smallest thread count with at least 95% of the best visits/s.
pub fn choose_threads(speeds: &[ThreadSpeed]) -> Option<u32> {
    let usable = || speeds.iter().filter(|s| s.visits_per_second.is_finite());
    let best = usable().map(|s| s.visits_per_second).reduce(f64::max)?;
    usable()
        .filter(|s| s.visits_per_second >= 0.95 * best)
        .map(|s| s.threads)
        .min()
}

/// Runs `benchmark` with `plan`. A run that stays silent for `stall` is timedOut; one that
/// exits non-zero, or prints no result, is classified from its stderr tail and the last 20
/// lines of stdout, where `benchmark` logs (findings 4c).
pub async fn run_benchmark(
    files: &EngineFiles,
    plan: &BenchmarkPlan,
    stall: Duration,
) -> Result<Vec<ThreadSpeed>, StepFailure> {
    eprintln!(
        "aji: benchmarking KataGo {} with {:?} threads",
        files.katago.display(),
        plan.threads
    );
    let spec = katago_benchmark_launch(files, plan.visits, plan.positions, &plan.threads);
    let limits = RunLimits {
        stall,
        stderr_lines: 50,
    };
    let output = run_to_end(spec, limits).await.map_err(|e| StepFailure {
        code: FailureCode::Crashed,
        stderr_tail: vec![format!("aji: cannot start {}: {e}", files.katago.display())],
    })?;
    let lines = failure_lines(&output.stderr_tail, &output.stdout);
    if output.stalled {
        return Err(StepFailure {
            code: FailureCode::TimedOut,
            stderr_tail: lines,
        });
    }
    if output.exit.code == Some(0)
        && let Ok(speeds) = parse_benchmark(&output.stdout)
    {
        return Ok(speeds);
    }
    Err(StepFailure {
        code: classify(Some(output.exit), &lines),
        stderr_tail: lines,
    })
}

/// How many of stdout's last lines a failure keeps, after the stderr tail.
const STDOUT_LINES: usize = 20;

/// The stderr tail, then stdout's last non-empty lines, progress lines split at `\r`.
fn failure_lines(stderr_tail: &[String], stdout: &str) -> Vec<String> {
    let stdout: Vec<&str> = stdout
        .split(['\n', '\r'])
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .collect();
    let from = stdout.len().saturating_sub(STDOUT_LINES);
    stderr_tail
        .iter()
        .cloned()
        .chain(stdout[from..].iter().map(|line| line.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn fixture(name: &str) -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/benchmark/1.18.2-metal")
            .join(name);
        std::fs::read_to_string(path).unwrap()
    }

    fn pairs(speeds: &[ThreadSpeed]) -> Vec<(u32, f64)> {
        speeds
            .iter()
            .map(|s| (s.threads, s.visits_per_second))
            .collect()
    }

    fn speeds(list: &[(u32, f64)]) -> Vec<ThreadSpeed> {
        list.iter()
            .map(|&(threads, visits_per_second)| ThreadSpeed {
                threads,
                visits_per_second,
            })
            .collect()
    }

    const TF2: &str = "kata1-tf2-b10c384-s2941M-d5872M.stdout.txt";
    const TF3_FIXED: &str = "kata1-tf3-b11c768-s12382M-d6533M.fixed-threads.stdout.txt";
    const B28_PARTIAL: &str = "kata1-b28c512nbt-s13255194368-d5935380940.partial.stdout.txt";

    #[test]
    fn parses_the_auto_tuned_run() {
        let parsed = parse_benchmark(&fixture(TF2)).unwrap();
        assert_eq!(
            pairs(&parsed),
            [
                (3, 202.27),
                (5, 207.13),
                (6, 234.99),
                (8, 227.76),
                (10, 244.33),
                (12, 213.31)
            ]
        );
    }

    #[test]
    fn parses_the_fixed_thread_run() {
        // The re-measure of 6 threads after "Running additional tests" is ignored.
        let parsed = parse_benchmark(&fixture(TF3_FIXED)).unwrap();
        assert_eq!(pairs(&parsed), [(6, 51.03), (8, 50.81), (10, 50.82)]);
    }

    #[test]
    fn parses_a_truncated_run() {
        let parsed = parse_benchmark(&fixture(B28_PARTIAL)).unwrap();
        assert_eq!(pairs(&parsed), [(5, 78.47), (12, 82.74)]);
    }

    #[test]
    fn garbage_is_an_error() {
        assert_eq!(parse_benchmark(""), Err(BenchmarkParseError::NoResults));
        assert_eq!(
            parse_benchmark(
                "numSearchThreads =  6: 3 / 10 positions, visits/s = 45.04 (53.6 secs)"
            ),
            Err(BenchmarkParseError::NoResults),
            "an unfinished count is no result"
        );
        assert_eq!(
            parse_benchmark("visits/s = 12\nnumSearchThreads = x: 1 / 1 positions"),
            Err(BenchmarkParseError::NoResults)
        );
    }

    #[test]
    fn the_smallest_count_within_95_percent_wins() {
        let tf2: Vec<ThreadSpeed> = parse_benchmark(&fixture(TF2))
            .unwrap()
            .into_iter()
            .filter(|s| [6, 8, 10].contains(&s.threads))
            .collect();
        assert_eq!(choose_threads(&tf2), Some(6));
        let tf3 = parse_benchmark(&fixture(TF3_FIXED)).unwrap();
        assert_eq!(choose_threads(&tf3), Some(6));
        assert_eq!(
            choose_threads(&speeds(&[(5, 100.0), (10, 200.0)])),
            Some(10)
        );
        assert_eq!(choose_threads(&speeds(&[(10, 200.0), (5, 195.0)])), Some(5));
        assert_eq!(choose_threads(&[]), None);
    }

    #[test]
    fn a_failure_keeps_stderr_then_the_last_20_lines_of_stdout() {
        let stderr = vec!["e1".to_string(), "e2".to_string()];
        let stdout: String =
            (1..=30).map(|n| format!("p{n}   \r")).collect::<String>() + "last\n\n";
        let lines = failure_lines(&stderr, &stdout);
        assert_eq!(lines.len(), 2 + 20, "{lines:?}");
        assert_eq!(&lines[..3], ["e1", "e2", "p12"]);
        assert_eq!(lines.last().unwrap(), "last");
        assert_eq!(failure_lines(&stderr, ""), stderr);
    }

    #[test]
    fn cpu_threads_follow_the_cores() {
        let plan = benchmark_plan(Backend::Eigenavx2, 8);
        assert_eq!((plan.visits, plan.positions), (100, 3));
        assert_eq!(plan.threads, [4, 8]);
        assert_eq!(benchmark_plan(Backend::Eigen, 1).threads, [1]);
        assert_eq!(benchmark_plan(Backend::Eigen, 0).threads, [1]);
        assert_eq!(benchmark_plan(Backend::Eigen, 3).threads, [1, 3]);
    }

    #[test]
    fn gpu_plans() {
        let metal = benchmark_plan(Backend::Metal, 10);
        assert_eq!(
            metal,
            BenchmarkPlan {
                visits: 400,
                positions: 5,
                threads: vec![6, 10, 16]
            }
        );
        for backend in [
            Backend::Cuda,
            Backend::Rocm,
            Backend::Directml,
            Backend::Openvino,
            Backend::Opencl,
        ] {
            let plan = benchmark_plan(backend, 10);
            assert_eq!((plan.visits, plan.positions), (400, 5), "{backend:?}");
            assert_eq!(plan.threads, [8, 16, 32], "{backend:?}");
        }
    }
}
