//! The install job end to end: engine packages around the fake KataGo, served from a local
//! server in a manifest built in code, on a synthetic Linux x64 machine with an AMD GPU, so the
//! recommendation is opencl, then eigenavx2, on every host OS.

mod common;

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aji_core::{BoardSize, Komi, Position, Rules};
use aji_engine::{EngineOptions, EngineState};
use aji_manager::Setup;
use aji_manager::hardware::{CpuReport, GpuReport, GpuVendor, HardwareReport, OsKind, OsReport};
use aji_manager::install::{
    DownloadOptions, DownloadSource, FailureCode, FallbackOffer, FreeSpace, ImportError,
    InstallOptions, InstallRequest, InstallRoot, Installed, InstalledNetwork, Installer,
    InstallerParts, JobOutcome, JobSnapshot, LicenceInfo, LicensedComponent, SPACE_MARGIN, SetKey,
    StartError, TaskKind, TaskState, import_network, load_installed,
};
use aji_manager::manifest::{
    Archive, Backend, ClientOptions, Digest, Engine, FileRef, Licence, Manifest, ManifestStore,
    Network, NetworkKind, NetworkLicence, Platform, Runtime, RuntimeComponent, http_client,
};
use aji_manager::recommend::DriverAdvice;
use common::engine_zip::{engine_zip, zip_of};
use common::http::{FileMode, FileReply, TestServer, serve_files};
use serde_json::{Value, json};
use sha2::Digest as _;
use tokio::sync::watch;
use tokio::time::Instant;

const OPENCL: &str = "katago-v1.18.2-opencl-linux-x64";
const EIGEN: &str = "katago-v1.18.2-eigenavx2-linux-x64";
const NET: &str = "kata1-b18c384nbt-test";
const RT: &str = "nvidia-test-runtime";
const LICENCE_HASH: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

const OOM: &str = "ERROR: NN server thread failed: CUDA Error, for Buffers file cudaandrocmbackend.inc, func Buffers, line 4724, error out of memory";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256(bytes: &[u8]) -> String {
    hex(&sha2::Sha256::digest(bytes))
}

/// The plan's thread counts for opencl (8, 16, 32): 16 is the smallest within 95% of 185.
fn opencl_speeds() -> Value {
    json!({ "8": 100.0, "16": 180.0, "32": 185.0 })
}

/// The plan's counts for eigenavx2 on 8 cores (4, 8).
fn eigen_speeds() -> Value {
    json!({ "4": 50.0, "8": 60.0 })
}

fn working(speeds: Value) -> Value {
    json!({ "benchmark": { "visitsPerSecond": speeds } })
}

fn failing_benchmark() -> Value {
    json!({
        "benchmark": { "visitsPerSecond": opencl_speeds() },
        "failure": { "during": "benchmark", "stderr": [OOM], "exitCode": 3 }
    })
}

struct Spec {
    opencl: Value,
    opencl_config: BTreeMap<String, String>,
    /// The opencl engine needs the runtime `RT`, whose licence needs acceptance.
    opencl_runtime: bool,
    eigen: Value,
    /// Route modes other than `Normal`.
    modes: HashMap<&'static str, FileMode>,
    space: u64,
    download_stall: Duration,
    progress_every: Duration,
    root_name: &'static str,
    report: HardwareReport,
    runtime_min_driver: Option<String>,
}

impl Default for Spec {
    fn default() -> Self {
        Spec {
            opencl: working(opencl_speeds()),
            opencl_config: BTreeMap::new(),
            opencl_runtime: false,
            eigen: working(eigen_speeds()),
            modes: HashMap::new(),
            space: u64::MAX / 2,
            download_stall: Duration::from_secs(10),
            progress_every: Duration::from_millis(250),
            root_name: "aji",
            report: report(),
            runtime_min_driver: None,
        }
    }
}

struct Space(u64);

impl FreeSpace for Space {
    fn available(&self, _: &Path) -> std::io::Result<u64> {
        Ok(self.0)
    }
}

struct World {
    _dir: tempfile::TempDir,
    root: InstallRoot,
    server: TestServer,
    installer: Arc<Installer>,
    engine: aji_engine::Engine,
    snapshots: Arc<Mutex<Vec<JobSnapshot>>>,
    _source: watch::Sender<DownloadSource>,
    sizes: HashMap<&'static str, u64>,
    opencl_zip: Vec<u8>,
}

fn report() -> HardwareReport {
    HardwareReport {
        os: OsReport {
            kind: OsKind::Linux,
            version: String::new(),
            arch: "x86_64".into(),
        },
        cpu: CpuReport {
            name: "cpu".into(),
            cores: 8,
            threads: 16,
            avx2: true,
        },
        memory_bytes: 16 << 30,
        gpus: vec![GpuReport {
            vendor: GpuVendor::Amd,
            name: "AMD Radeon RX 7800 XT".into(),
            memory_bytes: Some(16 << 30),
            driver_version: None,
            pci_device_id: None,
            apple_gpu_cores: None,
            compute_capability: None,
            software: false,
        }],
        problems: Vec::new(),
    }
}

/// 4 MiB, so a download gives many progress callbacks.
fn network_bytes() -> Vec<u8> {
    (0..4u32 << 20).map(|i| (i * 31 + i / 7) as u8).collect()
}

fn file_ref(server: &TestServer, route: &str, bytes: &[u8], digest: Digest) -> FileRef {
    FileRef {
        name: route.rsplit('/').next().unwrap().to_string(),
        size: bytes.len() as u64,
        digest,
        urls: vec![format!("{}{route}", server.base)],
    }
}

fn engine(id: &str, backend: Backend, file: FileRef) -> Engine {
    Engine {
        id: id.into(),
        version: semver::Version::new(1, 18, 2),
        released: "2026-11-01".into(),
        platform: Platform::LinuxX64,
        backend,
        variant: String::new(),
        runtime: None,
        gpu_family: None,
        config: BTreeMap::new(),
        file,
    }
}

fn world(spec: Spec) -> World {
    let opencl_zip = engine_zip(spec.opencl.clone());
    let eigen_zip = engine_zip(spec.eigen.clone());
    let net = network_bytes();
    let runtime_zip = zip_of(&[("bin/x.dll", b"a runtime library"), ("bin/notes.txt", b"x")]);
    let routes: Vec<(&str, Vec<u8>)> = vec![
        ("/opencl.zip", opencl_zip.clone()),
        ("/eigen.zip", eigen_zip.clone()),
        ("/net.bin.gz", net.clone()),
        ("/rt/x.zip", runtime_zip.clone()),
    ];
    let server = serve_files(
        routes
            .iter()
            .map(|(route, body)| {
                let mode = spec.modes.get(route).cloned().unwrap_or(FileMode::Normal);
                let reply = FileReply {
                    body: body.clone(),
                    mode,
                };
                (*route, reply)
            })
            .collect(),
    );

    let sha = |bytes: &[u8]| Digest::Sha256(sha256(bytes));
    let mut opencl = engine(
        OPENCL,
        Backend::Opencl,
        file_ref(&server, "/opencl.zip", &opencl_zip, sha(&opencl_zip)),
    );
    opencl.config = spec.opencl_config.clone();
    if spec.opencl_runtime {
        opencl.runtime = Some(RT.into());
    }
    let eigen = engine(
        EIGEN,
        Backend::Eigenavx2,
        file_ref(&server, "/eigen.zip", &eigen_zip, sha(&eigen_zip)),
    );
    let md5 = Digest::Md5(hex(&md5::Md5::digest(&net)));
    let network = Network {
        id: NET.into(),
        family: "kata1".into(),
        kind: NetworkKind::Main,
        elo: None,
        elo_games: None,
        uploaded: "2026-01-01".into(),
        min_engine_version: None,
        file: file_ref(&server, "/net.bin.gz", &net, md5),
        licence: NetworkLicence {
            name: "KataGo network licence".into(),
            url: "https://katagotraining.org/network_license/".into(),
        },
    };
    let runtime = Runtime {
        id: RT.into(),
        platform: Platform::LinuxX64,
        min_driver: spec.runtime_min_driver.clone(),
        min_compute_capability: None,
        components: vec![RuntimeComponent {
            product: "cudnn".into(),
            name: "cuDNN".into(),
            version: "9.0.0".into(),
            nvidia_manifest: "redistrib_9.0.0.json".into(),
            archive: Archive {
                path: "rt/x.zip".into(),
                size: runtime_zip.len() as u64,
                digest: sha(&runtime_zip),
            },
            hosts: vec![format!("{}/", server.base)],
            extract: vec!["x.dll".into()],
            licence: Licence {
                name: "NVIDIA Software License Agreement".into(),
                url: "https://docs.nvidia.com/cudnn/latest/reference/eula.html".into(),
                text_url: "https://docs.nvidia.com/cudnn/latest/reference/eula.html".into(),
                text_sha256: LICENCE_HASH.into(),
                requires_acceptance: true,
            },
        }],
        notice: String::new(),
    };
    let manifest = Manifest {
        schema: 1,
        sequence: 1,
        generated: "2026-11-20T00:00:00Z".into(),
        engines: vec![opencl, eigen],
        runtimes: vec![runtime],
        networks: vec![network],
    };

    let dir = tempfile::tempdir().unwrap();
    let root = InstallRoot::new(dir.path().join(spec.root_name));
    let setup = Arc::new(Setup::with_hardware(
        ManifestStore::fixed(manifest),
        spec.report.clone(),
    ));
    let komi = Komi::new(7.5).unwrap();
    let position = Position::empty(BoardSize::NINETEEN, Rules::Chinese, komi);
    let engine = aji_engine::Engine::spawn(None, position, EngineOptions::default(), |_| {});
    let client = http_client(
        "Aji/test",
        ClientOptions {
            timeout: None,
            connect_timeout: Duration::from_secs(5),
        },
    )
    .unwrap();
    let (source_tx, source) = watch::channel(DownloadSource::Direct);
    let options = InstallOptions {
        download: DownloadOptions {
            stall: spec.download_stall,
            tries_per_url: 1,
            backoff: vec![Duration::from_millis(10)],
        },
        benchmark_stall: Duration::from_secs(10),
        test_query_timeout: Duration::from_secs(20),
        progress_every: spec.progress_every,
    };
    let snapshots = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&snapshots);
    let installer = Installer::new(
        InstallerParts {
            root: root.clone(),
            setup,
            engine: engine.clone(),
            client,
            source,
            space: Arc::new(Space(spec.space)),
            options,
        },
        move |snapshot| seen.lock().unwrap().push(snapshot),
    );
    let sizes = HashMap::from([
        ("opencl", opencl_zip.len() as u64),
        ("eigen", eigen_zip.len() as u64),
        ("net", net.len() as u64),
    ]);
    World {
        _dir: dir,
        root,
        server,
        installer,
        engine,
        snapshots,
        _source: source_tx,
        sizes,
        opencl_zip,
    }
}

fn request(engine: &str, network: &str, accepted: &[&str]) -> InstallRequest {
    InstallRequest {
        engine: engine.into(),
        network: network.into(),
        accepted_licences: accepted.iter().map(|s| s.to_string()).collect(),
    }
}

impl World {
    async fn finished(&self) -> JobSnapshot {
        tokio::time::timeout(Duration::from_secs(60), self.installer.finished())
            .await
            .expect("the job ends")
            .expect("a job ran")
    }

    async fn install_with(&self, engine: &str, network: &str, accepted: &[&str]) -> JobSnapshot {
        self.installer
            .start(request(engine, network, accepted))
            .unwrap();
        self.finished().await
    }

    async fn install(&self, engine: &str) -> JobSnapshot {
        self.install_with(engine, NET, &[]).await
    }

    fn requests_for(&self, path: &str) -> usize {
        self.server
            .requests()
            .iter()
            .filter(|r| r.path == path)
            .count()
    }

    fn record(&self) -> Installed {
        load_installed(&self.root.record_file())
    }

    /// Waits until the analysing engine runs.
    async fn engine_runs(&self) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !matches!(
            self.engine.state(),
            EngineState::Ready { .. } | EngineState::Analysing { .. }
        ) {
            assert!(
                Instant::now() < deadline,
                "the engine never ran: {:?}",
                self.engine.state()
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Waits until the running job's `task` row has `bytes` done.
    async fn row_reaches(&self, task: TaskKind, bytes: u64) {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let snapshot = self.installer.status().expect("a job");
            if let Some(TaskState::Running { done, .. }) = state_of(&snapshot, task)
                && done >= bytes
            {
                return;
            }
            assert!(Instant::now() < deadline, "{snapshot:?}");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

fn state_of(snapshot: &JobSnapshot, task: TaskKind) -> Option<TaskState> {
    snapshot
        .tasks
        .iter()
        .find(|row| row.task == task)
        .map(|row| row.state)
}

fn kinds(snapshot: &JobSnapshot) -> Vec<TaskKind> {
    snapshot.tasks.iter().map(|row| row.task).collect()
}

/// The failure, its tail and its offer, or a panic naming the outcome.
fn failed(snapshot: &JobSnapshot) -> (FailureCode, Vec<String>, Option<FallbackOffer>) {
    match &snapshot.outcome {
        Some(JobOutcome::Failed {
            failure,
            stderr_tail,
            offer,
            ..
        }) => (*failure, stderr_tail.clone(), offer.clone()),
        other => panic!("not failed: {other:?} in {snapshot:?}"),
    }
}

fn key(engine: &str) -> Option<SetKey> {
    Some(SetKey {
        engine: engine.into(),
        network: NET.into(),
    })
}

#[tokio::test]
async fn installs_and_activates_an_engine() {
    let w = world(Spec::default());
    let job = w.install(OPENCL).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    assert_eq!(job.backend, Backend::Opencl);
    assert_eq!(
        kinds(&job),
        [
            TaskKind::Engine,
            TaskKind::Network,
            TaskKind::Benchmark,
            TaskKind::TestQuery
        ]
    );
    assert!(
        job.tasks.iter().all(|row| row.state == TaskState::Done),
        "{job:?}"
    );

    let record = w.record();
    assert_eq!(record, w.installer.installed());
    assert_eq!(record.active, key(OPENCL));
    let set = record.active_set().unwrap();
    assert_eq!(set.threads, 16);
    assert_eq!(set.config, format!("configs/{OPENCL}+{NET}.cfg"));
    assert_eq!(set.benchmark.len(), 3);
    let config = std::fs::read_to_string(w.root.root().join(&set.config)).unwrap();
    assert!(
        config.contains("numSearchThreadsPerAnalysisThread = 16\n"),
        "{config}"
    );
    assert!(w.root.engine_dir(OPENCL).join(common::fake::EXE).is_file());
    assert!(w.root.network_file("net.bin.gz").is_file());
    let left: Vec<_> = std::fs::read_dir(w.root.downloads_dir())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert!(left.is_empty(), "the zips are deleted: {left:?}");
    w.engine_runs().await;
}

#[tokio::test]
async fn a_backend_failure_offers_the_next_backend() {
    let w = world(Spec {
        opencl: failing_benchmark(),
        ..Spec::default()
    });
    let job = w.install(OPENCL).await;
    let (failure, tail, offer) = failed(&job);
    assert_eq!(failure, FailureCode::OutOfMemory);
    assert!(tail.iter().any(|l| l == OOM), "{tail:?}");
    assert_eq!(
        offer,
        Some(FallbackOffer {
            backend: Backend::Eigenavx2,
            engine: EIGEN.into(),
            download_bytes: w.sizes["eigen"],
            runtime_bytes: None,
        })
    );
    assert_eq!(
        state_of(&job, TaskKind::Benchmark),
        Some(TaskState::Failed {
            failure: FailureCode::OutOfMemory
        })
    );
    let record = w.record();
    assert_eq!(record.active, None);
    assert!(record.sets.is_empty());
    assert!(record.engines.contains_key(OPENCL));
    assert!(record.networks.contains_key(NET));
}

#[tokio::test]
async fn accepting_the_offer_reuses_the_network() {
    let w = world(Spec {
        opencl: failing_benchmark(),
        ..Spec::default()
    });
    let (_, _, offer) = failed(&w.install(OPENCL).await);
    let job = w.install(&offer.unwrap().engine).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    assert_eq!(state_of(&job, TaskKind::Network), Some(TaskState::Reused));
    assert_eq!(w.requests_for("/net.bin.gz"), 1);
    assert_eq!(w.record().active, key(EIGEN));
}

#[tokio::test]
async fn a_failed_reinstall_keeps_the_active_engine() {
    let w = world(Spec {
        opencl: failing_benchmark(),
        ..Spec::default()
    });
    assert_eq!(w.install(EIGEN).await.outcome, Some(JobOutcome::Installed));
    w.engine_runs().await;
    let first = w.engine.pid();

    failed(&w.install(OPENCL).await);
    assert_eq!(w.record().active, key(EIGEN));
    // The engine runs the old files again, in a new process.
    let pid_file = w.root.engine_dir(EIGEN).join("fake-katago.pid");
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let pid = w.engine.pid();
        let written = std::fs::read_to_string(&pid_file).ok();
        if pid.is_some()
            && pid != first
            && written.as_deref().map(str::trim) == pid.map(|p| p.to_string()).as_deref()
        {
            break;
        }
        assert!(Instant::now() < deadline, "{:?}", w.engine.state());
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    w.engine_runs().await;
}

#[tokio::test]
async fn a_network_download_failure_offers_nothing() {
    let w = world(Spec {
        modes: HashMap::from([("/net.bin.gz", FileMode::NotFound)]),
        ..Spec::default()
    });
    let job = w.install(OPENCL).await;
    let (failure, _, offer) = failed(&job);
    assert_eq!(failure, FailureCode::DownloadFailed);
    assert_eq!(offer, None);
    assert_eq!(
        state_of(&job, TaskKind::Network),
        Some(TaskState::Failed {
            failure: FailureCode::DownloadFailed
        })
    );
    assert_eq!(w.record().active, None);
}

#[tokio::test]
async fn an_unaccepted_licence_fails_before_downloading() {
    let w = world(Spec {
        opencl_runtime: true,
        ..Spec::default()
    });
    assert_eq!(
        w.installer.licences(OPENCL),
        Some(vec![LicenceInfo {
            name: "NVIDIA Software License Agreement".into(),
            url: "https://docs.nvidia.com/cudnn/latest/reference/eula.html".into(),
            text_sha256: LICENCE_HASH.into(),
            components: vec![LicensedComponent {
                name: "cuDNN".into(),
                version: "9.0.0".into(),
                bytes: zip_of(&[("bin/x.dll", b"a runtime library"), ("bin/notes.txt", b"x")]).len()
                    as u64,
            }],
        }])
    );
    assert_eq!(w.installer.licences(EIGEN), Some(Vec::new()));
    assert_eq!(w.installer.licences("no-such-engine"), None);

    let job = w.install(OPENCL).await;
    let (failure, _, offer) = failed(&job);
    assert_eq!(failure, FailureCode::LicenceNotAccepted);
    assert_eq!(offer.map(|o| o.engine), Some(EIGEN.to_string()));
    assert!(w.server.requests().is_empty(), "{:?}", w.server.requests());
}

#[tokio::test]
async fn not_enough_space_for_the_backend_offers_the_next() {
    let w = world(Spec {
        space: (4 << 20) + SPACE_MARGIN,
        ..Spec::default()
    });
    let (failure, _, offer) = failed(&w.install(OPENCL).await);
    assert_eq!(failure, FailureCode::NotEnoughSpace);
    assert_eq!(offer.map(|o| o.engine), Some(EIGEN.to_string()));
    assert!(w.server.requests().is_empty());
}

#[tokio::test]
async fn not_enough_space_for_the_network_offers_nothing() {
    let w = world(Spec {
        space: 0,
        ..Spec::default()
    });
    let (failure, tail, offer) = failed(&w.install(OPENCL).await);
    assert_eq!(failure, FailureCode::NotEnoughSpace);
    assert_eq!(offer, None);
    assert!(!tail.is_empty(), "the tail says how much is needed");
    assert!(w.server.requests().is_empty());
}

#[tokio::test]
async fn cancel_ends_the_job_and_keeps_part_files() {
    let half = engine_zip(working(opencl_speeds())).len() / 2;
    let w = world(Spec {
        modes: HashMap::from([("/opencl.zip", FileMode::StallAfter(half))]),
        download_stall: Duration::from_secs(60),
        ..Spec::default()
    });
    w.installer.start(request(OPENCL, NET, &[])).unwrap();
    w.row_reaches(TaskKind::Engine, half as u64).await;
    w.installer.cancel();
    let job = tokio::time::timeout(Duration::from_secs(5), w.installer.finished())
        .await
        .expect("cancel ends the job at once")
        .unwrap();
    assert_eq!(job.outcome, Some(JobOutcome::Cancelled));
    let part = w.root.downloads_dir().join("opencl.zip.part");
    assert_eq!(std::fs::metadata(part).unwrap().len(), half as u64);
    assert_eq!(w.record().active, None);
}

#[tokio::test]
async fn a_verified_download_is_reused_after_a_restart() {
    let w = world(Spec::default());
    // A complete, verified download left behind by a crash.
    std::fs::create_dir_all(w.root.downloads_dir()).unwrap();
    std::fs::write(w.root.downloads_dir().join("opencl.zip"), &w.opencl_zip).unwrap();
    let job = w.install(OPENCL).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    assert_eq!(w.requests_for("/opencl.zip"), 0);
}

#[tokio::test]
async fn a_second_job_while_one_runs_is_busy() {
    let half = engine_zip(working(opencl_speeds())).len() / 2;
    let w = world(Spec {
        modes: HashMap::from([("/opencl.zip", FileMode::StallAfter(half))]),
        download_stall: Duration::from_secs(60),
        ..Spec::default()
    });
    assert_eq!(
        w.installer.start(request("no-such-engine", NET, &[])),
        Err(StartError::UnknownEngine)
    );
    assert_eq!(
        w.installer.start(request(OPENCL, "no-such-network", &[])),
        Err(StartError::UnknownNetwork)
    );
    w.installer.start(request(OPENCL, NET, &[])).unwrap();
    assert_eq!(
        w.installer.start(request(EIGEN, NET, &[])),
        Err(StartError::Busy)
    );
    w.installer.cancel();
    assert_eq!(w.finished().await.outcome, Some(JobOutcome::Cancelled));
}

#[tokio::test]
async fn the_benchmark_gets_the_manifest_overrides() {
    let mut scenario = working(opencl_speeds());
    scenario["requireConfig"] = json!({ "onnxProvider": "directml" });
    let w = world(Spec {
        opencl: scenario,
        opencl_config: BTreeMap::from([("onnxProvider".to_string(), "directml".to_string())]),
        ..Spec::default()
    });
    let job = w.install(OPENCL).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
}

#[tokio::test]
async fn a_runtime_folder_is_first_on_the_path() {
    let mut scenario = working(opencl_speeds());
    scenario["requirePathEntry"] = RT.into();
    let w = world(Spec {
        opencl: scenario,
        opencl_runtime: true,
        ..Spec::default()
    });
    let job = w.install_with(OPENCL, NET, &[LICENCE_HASH]).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    assert_eq!(
        kinds(&job),
        [
            TaskKind::Engine,
            TaskKind::Runtime,
            TaskKind::Network,
            TaskKind::Benchmark,
            TaskKind::TestQuery
        ]
    );
    let record = w.record();
    assert!(record.runtimes.contains_key(RT));
    assert_eq!(record.active_set().unwrap().runtime.as_deref(), Some(RT));
    let runtime = w.root.runtime_dir(RT);
    assert!(runtime.join("x.dll").is_file());
    assert!(!runtime.join("notes.txt").exists());
    assert!(
        !w.root.downloads_dir().join("x.zip").exists(),
        "the archive is deleted"
    );
    w.engine_runs().await;
}

/// Recorded files that went missing or were damaged (a manual delete, an antivirus quarantine,
/// a power cut) are installed again instead of being trusted.
#[tokio::test]
async fn recorded_files_that_went_missing_are_installed_again() {
    let mut scenario = working(opencl_speeds());
    scenario["requirePathEntry"] = RT.into();
    let w = world(Spec {
        opencl: scenario,
        opencl_runtime: true,
        ..Spec::default()
    });
    let job = w.install_with(OPENCL, NET, &[LICENCE_HASH]).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    std::fs::remove_file(w.root.engine_dir(OPENCL).join(common::fake::EXE)).unwrap();
    std::fs::remove_file(w.root.runtime_dir(RT).join("x.dll")).unwrap();
    let network = w.root.network_file("net.bin.gz");
    let bytes = std::fs::read(&network).unwrap();
    std::fs::write(&network, &bytes[..bytes.len() / 2]).unwrap();

    let job = w.install_with(OPENCL, NET, &[LICENCE_HASH]).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    assert_eq!(w.requests_for("/opencl.zip"), 2);
    assert_eq!(w.requests_for("/rt/x.zip"), 2);
    assert_eq!(w.requests_for("/net.bin.gz"), 2);
    assert!(w.root.engine_dir(OPENCL).join(common::fake::EXE).is_file());
    assert!(w.root.runtime_dir(RT).join("x.dll").is_file());
    assert_eq!(std::fs::read(&network).unwrap(), bytes);
}

/// Recorded files that are all there are reused: nothing is fetched again.
#[tokio::test]
async fn intact_recorded_files_are_reused() {
    let w = world(Spec::default());
    assert_eq!(w.install(OPENCL).await.outcome, Some(JobOutcome::Installed));
    let job = w.install(OPENCL).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    assert_eq!(w.requests_for("/opencl.zip"), 1);
    assert_eq!(w.requests_for("/net.bin.gz"), 1);
}

#[tokio::test]
async fn installs_from_a_root_with_cjk_and_spaces() {
    let w = world(Spec {
        root_name: "数据 文件夹",
        ..Spec::default()
    });
    let job = w.install(EIGEN).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    w.engine_runs().await;
}

#[tokio::test]
async fn an_imported_network_can_be_installed_with() {
    let w = world(Spec::default());
    let source = w.root.root().parent().unwrap().join("my net.bin.gz");
    let mut bytes = vec![0x1f, 0x8b, 0x08, 0x00];
    bytes.extend_from_slice(b"an imported network");
    std::fs::write(&source, &bytes).unwrap();
    let imported = w.installer.import_network(&source).unwrap();
    let job = w.install_with(EIGEN, &imported.id, &[]).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    assert_eq!(job.network, imported.id);
    assert_eq!(w.requests_for("/net.bin.gz"), 0);
    assert_eq!(
        w.record().active,
        Some(SetKey {
            engine: EIGEN.into(),
            network: imported.id.clone(),
        })
    );
}

#[tokio::test]
async fn progress_is_throttled_and_ends_with_the_outcome() {
    let w = world(Spec {
        progress_every: Duration::from_secs(3600),
        ..Spec::default()
    });
    let job = w.install(EIGEN).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    let snapshots = w.snapshots.lock().unwrap().clone();
    assert_eq!(snapshots.last(), Some(&job));
    assert!(snapshots.iter().all(|s| s.id == job.id));
    assert!(
        snapshots[..snapshots.len() - 1]
            .iter()
            .all(|s| s.outcome.is_none())
    );
    // 4 MiB of network arrive in many chunks; with an hour between byte updates, none of the
    // part-way ones goes out.
    let part_way = snapshots
        .iter()
        .filter(|s| {
            matches!(state_of(s, TaskKind::Network),
                Some(TaskState::Running { done, total }) if done > 0 && done < total)
        })
        .count();
    assert_eq!(part_way, 0, "{snapshots:#?}");
    assert!(snapshots.len() < 20, "{} snapshots", snapshots.len());
    // Every row went from waiting through running to done.
    for task in kinds(&job) {
        assert!(
            snapshots
                .iter()
                .any(|s| matches!(state_of(s, task), Some(TaskState::Running { .. }))),
            "{task:?} never ran"
        );
    }
    assert_eq!(w.sizes["net"], 4 << 20);
}

#[test]
fn import_network_copies_a_gzip_file() {
    let dir = tempfile::tempdir().unwrap();
    let root = InstallRoot::new(dir.path().join("aji"));
    let source = dir.path().join("my net.bin.gz");
    let mut bytes = vec![0x1f, 0x8b, 0x08, 0x00];
    bytes.extend(std::iter::repeat_n(7u8, 100_000));
    std::fs::write(&source, &bytes).unwrap();

    let imported = import_network(&root, &source).unwrap();
    let id = format!("imported-{}", &sha256(&bytes)[..16]);
    assert_eq!(imported.id, id);
    assert_eq!(imported.name, "my net");
    assert_eq!(imported.size_bytes, bytes.len() as u64);
    let file = format!("{id}.bin.gz");
    assert_eq!(std::fs::read(root.network_file(&file)).unwrap(), bytes);
    assert_eq!(
        load_installed(&root.record_file()).networks.get(&id),
        Some(&InstalledNetwork {
            file,
            name: "my net".into(),
            imported: true,
        })
    );
    // Importing the same file again gives the same network.
    assert_eq!(import_network(&root, &source).unwrap(), imported);
}

#[test]
fn import_network_rejects_other_files() {
    let dir = tempfile::tempdir().unwrap();
    let root = InstallRoot::new(dir.path().join("aji"));
    for (name, bytes) in [
        ("net.zip", b"PK\x03\x04 a zip".as_slice()),
        ("one-byte", b"\x1f".as_slice()),
        ("empty", b"".as_slice()),
    ] {
        let source = dir.path().join(name);
        std::fs::write(&source, bytes).unwrap();
        assert_eq!(
            import_network(&root, &source),
            Err(ImportError::NotGzip),
            "{name}"
        );
    }
    assert!(matches!(
        import_network(&root, &dir.path().join("missing.bin.gz")),
        Err(ImportError::Io(_))
    ));
    let networks = root.root().join("networks");
    assert!(
        std::fs::read_dir(&networks).map_or(true, |mut d| d.next().is_none()),
        "nothing is left in networks/"
    );
    assert!(load_installed(&root.record_file()).networks.is_empty());
}

// ---------------------------------------------------------------- M5: reused rows, disk errors, driver advice

const INSUFFICIENT_DRIVER: &str = "ERROR: NN server thread failed: CUDA Error, for cudaMalloc file cudaandrocmbackend.inc, line 1: CUDA driver version is insufficient for CUDA runtime version";

#[tokio::test]
async fn a_verified_component_shows_reused() {
    let w = world(Spec::default());
    assert_eq!(w.install(OPENCL).await.outcome, Some(JobOutcome::Installed));
    w.snapshots.lock().unwrap().clear();
    let job = w.install(OPENCL).await;
    assert_eq!(job.outcome, Some(JobOutcome::Installed), "{job:?}");
    assert_eq!(state_of(&job, TaskKind::Engine), Some(TaskState::Reused));
    assert_eq!(state_of(&job, TaskKind::Network), Some(TaskState::Reused));
    for snapshot in w.snapshots.lock().unwrap().iter() {
        for task in [TaskKind::Engine, TaskKind::Network] {
            assert!(
                !matches!(state_of(snapshot, task), Some(TaskState::Running { .. })),
                "{snapshot:?}"
            );
        }
    }
}

fn nvidia_report(driver: &str) -> HardwareReport {
    let mut r = report();
    r.gpus = vec![GpuReport {
        vendor: GpuVendor::Nvidia,
        name: "NVIDIA GeForce RTX 3060".into(),
        memory_bytes: Some(12 << 30),
        driver_version: Some(driver.into()),
        pci_device_id: None,
        apple_gpu_cores: None,
        compute_capability: Some("8.6".into()),
        software: false,
    }];
    r
}

fn failing_with(line: &str) -> Value {
    json!({
        "benchmark": { "visitsPerSecond": opencl_speeds() },
        "failure": { "during": "benchmark", "stderr": [line], "exitCode": 1 }
    })
}

#[tokio::test]
async fn a_driver_failure_carries_the_advice() {
    let w = world(Spec {
        opencl: failing_with(INSUFFICIENT_DRIVER),
        opencl_runtime: true,
        runtime_min_driver: Some("580.00".into()),
        report: nvidia_report("575.0"),
        ..Spec::default()
    });
    let job = w.install_with(OPENCL, NET, &[LICENCE_HASH]).await;
    let Some(JobOutcome::Failed {
        failure,
        offer,
        driver,
        ..
    }) = &job.outcome
    else {
        panic!("{job:?}");
    };
    assert_eq!(*failure, FailureCode::GpuDriverTooOld);
    assert_eq!(
        driver,
        &Some(DriverAdvice {
            current: Some("575.0".into()),
            required: "580.00".into()
        })
    );
    assert_eq!(offer.as_ref().map(|o| o.backend), Some(Backend::Eigenavx2));
}

#[tokio::test]
async fn other_failures_carry_no_driver() {
    let w = world(Spec {
        opencl: failing_benchmark(),
        opencl_runtime: true,
        runtime_min_driver: Some("580.00".into()),
        report: nvidia_report("575.0"),
        ..Spec::default()
    });
    let job = w.install_with(OPENCL, NET, &[LICENCE_HASH]).await;
    let Some(JobOutcome::Failed {
        failure, driver, ..
    }) = &job.outcome
    else {
        panic!("{job:?}");
    };
    assert_eq!(*failure, FailureCode::OutOfMemory);
    assert_eq!(driver, &None);
}

#[cfg(unix)]
#[tokio::test]
async fn a_write_failure_in_the_root_is_disk_error() {
    use std::os::unix::fs::PermissionsExt;
    let w = world(Spec::default());
    let engines = w.root.root().join("engines");
    std::fs::create_dir_all(&engines).unwrap();
    std::fs::set_permissions(&engines, std::fs::Permissions::from_mode(0o555)).unwrap();
    let job = w.install(OPENCL).await;
    std::fs::set_permissions(&engines, std::fs::Permissions::from_mode(0o755)).unwrap();
    let (failure, _, offer) = failed(&job);
    assert_eq!(failure, FailureCode::DiskError, "{job:?}");
    assert_eq!(offer, None);
}

#[tokio::test]
async fn licences_list_their_components() {
    let w = world(Spec {
        opencl_runtime: true,
        ..Spec::default()
    });
    let licences: Vec<LicenceInfo> = w.installer.licences(OPENCL).unwrap();
    assert_eq!(licences.len(), 1);
    let runtime_zip = zip_of(&[("bin/x.dll", b"a runtime library"), ("bin/notes.txt", b"x")]);
    assert_eq!(
        licences[0].components,
        vec![LicensedComponent {
            name: "cuDNN".into(),
            version: "9.0.0".into(),
            bytes: runtime_zip.len() as u64,
        }]
    );
}
