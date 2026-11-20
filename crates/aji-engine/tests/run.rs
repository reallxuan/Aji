//! One-shot KataGo runs (`run_to_end`) against the fake KataGo in install mode: copied into a
//! folder of its own with a `key = value` config, as the installer leaves a real engine.

use std::path::{Path, PathBuf};
use std::time::Duration;

use aji_engine::{
    EngineFiles, RunLimits, RunOutput, katago_benchmark_launch, katago_launch, run_to_end,
};
use tokio::time::Instant;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixtures() -> PathBuf {
    manifest_dir().join("tests/fixtures")
}

const EXE: &str = if cfg!(windows) {
    "katago.exe"
} else {
    "katago"
};

/// An installed fake KataGo: its folder (removed on drop) and the files to run it with.
struct Install {
    dir: tempfile::TempDir,
    files: EngineFiles,
}

impl Install {
    /// Copies the fake and the scenario `name` from `fixtures/install` into a new folder,
    /// with `config` as `engine.cfg` and a model file.
    fn new(name: &str, config: &str) -> Install {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::copy(env!("CARGO_BIN_EXE_fake-katago"), root.join(EXE)).unwrap();
        let source = fixtures().join("install").join(format!("{name}.json"));
        let mut scenario: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&source).unwrap()).unwrap();
        if let Some(transcript) = scenario["transcript"].as_str() {
            let absolute = source.parent().unwrap().join(transcript);
            scenario["transcript"] = absolute.to_string_lossy().into_owned().into();
        }
        std::fs::write(
            root.join("fake-katago-scenario.json"),
            serde_json::to_vec(&scenario).unwrap(),
        )
        .unwrap();
        std::fs::write(root.join("engine.cfg"), config).unwrap();
        std::fs::write(root.join("model.bin.gz"), b"not a real network").unwrap();
        let files = EngineFiles {
            katago: root.join(EXE),
            model: PathBuf::from("model.bin.gz"),
            config: PathBuf::from("engine.cfg"),
            working_dir: root.to_path_buf(),
            path_prepend: Vec::new(),
        };
        Install { dir, files }
    }

    fn root(&self) -> &Path {
        self.dir.path()
    }
}

const BENCHMARK_CONFIG: &str = "numSearchThreads = 8\n";
const ANALYSIS_CONFIG: &str =
    "numAnalysisThreads = 1\nnumSearchThreadsPerAnalysisThread = 8\nnnMaxBatchSize = 8\n";

fn limits(stall: Duration) -> RunLimits {
    RunLimits {
        stall,
        stderr_lines: 50,
    }
}

async fn benchmark(install: &Install) -> RunOutput {
    let spec = katago_benchmark_launch(&install.files, 100, 5, &[8, 16]);
    run_to_end(spec, limits(Duration::from_secs(10)))
        .await
        .unwrap()
}

fn stderr_has(output: &RunOutput, text: &str) -> bool {
    output.stderr_tail.iter().any(|line| line.contains(text))
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
fn benchmark_launch_args_are_exact() {
    let install = Install::new("benchmark", BENCHMARK_CONFIG);
    let spec = katago_benchmark_launch(&install.files, 400, 5, &[8, 16, 32]);
    let args: Vec<String> = spec
        .args
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        args,
        [
            "benchmark",
            "-config",
            "engine.cfg",
            "-model",
            "model.bin.gz",
            "-v",
            "400",
            "-n",
            "5",
            "-t",
            "8,16,32",
            "-no-server-thread-test",
            "-no-half-batch-size-test",
        ]
    );
    assert_eq!(spec.working_dir, install.root());
    assert!(spec.env.is_empty());
}

#[tokio::test]
async fn run_to_end_collects_benchmark_output() {
    let install = Install::new("benchmark", BENCHMARK_CONFIG);
    let output = benchmark(&install).await;
    assert_eq!(output.exit.code, Some(0), "{output:?}");
    assert!(!output.stalled);
    assert!(
        output
            .stdout
            .contains("numSearchThreads = 16: 5 / 5 positions, visits/s = 180.00"),
        "{}",
        output.stdout
    );
    assert!(
        output
            .stdout
            .contains("numSearchThreads =  8: 5 / 5 positions, visits/s = 100.00")
    );
    assert!(
        output.stdout.contains('\r'),
        "progress lines keep their \\r"
    );
}

#[tokio::test]
async fn run_to_end_kills_a_stalled_process() {
    let install = Install::new("hang", BENCHMARK_CONFIG);
    let stall = Duration::from_millis(500);
    let spec = katago_benchmark_launch(&install.files, 100, 5, &[8]);
    let started = Instant::now();
    let output = run_to_end(spec, limits(stall)).await.unwrap();
    assert!(output.stalled);
    assert_ne!(output.exit.code, Some(0));
    assert!(started.elapsed() < stall + Duration::from_secs(2));
}

#[tokio::test]
async fn dropping_the_run_kills_the_process() {
    let install = Install::new("hang", BENCHMARK_CONFIG);
    let spec = katago_benchmark_launch(&install.files, 100, 5, &[8]);
    let run = tokio::spawn(run_to_end(spec, limits(Duration::from_secs(60))));

    // The fake writes its pid beside itself in install mode.
    let pid_file = install.root().join("fake-katago.pid");
    let deadline = Instant::now() + Duration::from_secs(10);
    let pid: u32 = loop {
        if let Ok(text) = std::fs::read_to_string(&pid_file)
            && let Ok(pid) = text.trim().parse()
        {
            break pid;
        }
        assert!(Instant::now() < deadline, "the fake never started");
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert!(alive(pid));

    run.abort();
    let deadline = Instant::now() + Duration::from_secs(2);
    while alive(pid) {
        assert!(
            Instant::now() < deadline,
            "KataGo {pid} outlived its dropped run"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn a_missing_required_config_key_fails() {
    let install = Install::new("require-onnx", BENCHMARK_CONFIG);
    let output = benchmark(&install).await;
    assert_eq!(output.exit.code, Some(1));
    assert!(stderr_has(
        &output,
        "fake-katago: missing config onnxProvider"
    ));

    let config = format!("{BENCHMARK_CONFIG}onnxProvider = directml\n");
    let install = Install::new("require-onnx", &config);
    assert_eq!(benchmark(&install).await.exit.code, Some(0));
}

#[tokio::test]
async fn katago_config_rules_are_enforced() {
    // benchmark needs numSearchThreads.
    let install = Install::new("benchmark", "nnMaxBatchSize = 8\n");
    let output = benchmark(&install).await;
    assert_eq!(output.exit.code, Some(1));
    assert!(stderr_has(
        &output,
        "Could not find key 'numSearchThreads' in config file engine.cfg"
    ));

    let analysis = |config: &str| {
        let install = Install::new("analysis", config);
        async move {
            let spec = katago_launch(&install.files);
            let output = run_to_end(spec, limits(Duration::from_secs(10)))
                .await
                .unwrap();
            drop(install);
            output
        }
    };
    let both = format!("{ANALYSIS_CONFIG}numSearchThreads = 8\n");
    let output = analysis(&both).await;
    assert_eq!(output.exit.code, Some(1));
    assert!(stderr_has(
        &output,
        "Cannot specify both numSearchThreadsPerAnalysisThread and numSearchThreads in the same config"
    ));
    for key in [
        "numAnalysisThreads",
        "nnMaxBatchSize",
        "numSearchThreadsPerAnalysisThread",
    ] {
        let config: String = ANALYSIS_CONFIG
            .lines()
            .filter(|line| !line.starts_with(key))
            .map(|line| format!("{line}\n"))
            .collect();
        let output = analysis(&config).await;
        // Without the per-analysis-thread key KataGo looks for the key it maps onto.
        let wanted = key.replace("PerAnalysisThread", "");
        assert!(
            stderr_has(&output, &format!("Could not find key '{wanted}'")),
            "{key}: {output:?}"
        );
    }
    // A valid analysis config starts, then exits on stdin's EOF.
    let output = analysis(ANALYSIS_CONFIG).await;
    assert_eq!(output.exit.code, Some(0), "{output:?}");
}

#[tokio::test]
async fn a_missing_model_fails() {
    let install = Install::new("benchmark", BENCHMARK_CONFIG);
    std::fs::remove_file(install.root().join("model.bin.gz")).unwrap();
    let output = benchmark(&install).await;
    assert_eq!(output.exit.code, Some(1));
    assert!(stderr_has(&output, "fake-katago: model not found"));
}

#[tokio::test]
async fn runtime_folder_with_cjk_reaches_the_path() {
    let mut install = Install::new("runtime-path", BENCHMARK_CONFIG);
    let output = benchmark(&install).await;
    assert_eq!(output.exit.code, Some(127), "no runtime folder: {output:?}");
    assert!(stderr_has(&output, "fake-katago: library not found"));

    let runtime = install.root().join("运行库 x");
    std::fs::create_dir(&runtime).unwrap();
    install.files.path_prepend = vec![runtime];
    let output = benchmark(&install).await;
    assert_eq!(output.exit.code, Some(0), "{output:?}");
}

#[tokio::test]
async fn a_failure_prints_its_stderr_and_exit_code() {
    let install = Install::new("cuda-oom", BENCHMARK_CONFIG);
    let output = benchmark(&install).await;
    assert_eq!(output.exit.code, Some(3));
    assert!(stderr_has(
        &output,
        "ERROR: NN server thread failed: CUDA Error, for ScratchBuffers"
    ));

    let install = Install::new("startup-failure", BENCHMARK_CONFIG);
    let output = benchmark(&install).await;
    assert_eq!(output.exit.code, Some(1));
    assert!(stderr_has(
        &output,
        "DirectML execution provider is not available"
    ));
    assert!(
        !output.stdout.contains("visits/s"),
        "it failed before the run"
    );
}
