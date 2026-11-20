//! The fake KataGo in install mode: copied into a folder of its own as `katago` (or
//! `katago.exe`) with its scenario beside it, as the installer leaves a real engine.

use std::path::{Path, PathBuf};

use aji_engine::EngineFiles;
use serde_json::Value;

pub const EXE: &str = if cfg!(windows) {
    "katago.exe"
} else {
    "katago"
};

/// A valid analysis config: KataGo's rules for the analysis command, which the fake enforces.
pub const ANALYSIS_CONFIG: &str =
    "numAnalysisThreads = 1\nnumSearchThreadsPerAnalysisThread = 8\nnnMaxBatchSize = 8\n";

/// A valid benchmark config.
pub const BENCHMARK_CONFIG: &str = "numSearchThreads = 8\n";

/// The M2 Metal transcript; its `p0` query is the empty 19×19 board, Chinese, 7.5.
pub fn transcript() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../aji-engine/tests/fixtures/katago/1.18.2-metal/analysis.jsonl")
        .to_string_lossy()
        .into_owned()
}

/// The fake with `scenario`, `config` as `engine.cfg` and a model file, in a new folder that is
/// KataGo's working directory.
pub fn install(scenario: &Value, config: &str) -> (tempfile::TempDir, EngineFiles) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::copy(
        env!("CARGO_BIN_EXE_aji-manager-fake-katago"),
        root.join(EXE),
    )
    .unwrap();
    std::fs::write(
        root.join("fake-katago-scenario.json"),
        serde_json::to_vec(scenario).unwrap(),
    )
    .unwrap();
    std::fs::write(root.join("engine.cfg"), config).unwrap();
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
pub fn fake_pid(dir: &Path) -> u32 {
    std::fs::read_to_string(dir.join("fake-katago.pid"))
        .expect("the fake started")
        .trim()
        .parse()
        .unwrap()
}

#[cfg(unix)]
pub fn alive(pid: u32) -> bool {
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
