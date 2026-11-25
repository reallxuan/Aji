//! The install job (design 5.3 to 5.9): download, unpack, benchmark, test and activate one
//! engine set, one job at a time, with progress, cancel and a fallback offer on failure.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use aji_engine::{EngineState, Throttle};
use serde::Serialize;
use tokio::runtime::Handle;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use super::unused::{ActiveSummary, RemoveError};
use super::{
    BenchmarkProgress, DownloadError, DownloadItem, DownloadOptions, DownloadSource, Downloader,
    EngineSet, FailureCode, FreeSpace, ImportError, ImportedNetwork, InstallRoot, Installed,
    InstalledEngine, InstalledNetwork, InstalledRuntime, NotEnoughSpace, Origin, ThreadSpeed,
    UnpackError, analysis_config, benchmark_config, benchmark_plan, check_space, choose_threads,
    default_threads, engine_files, extract_size, load_installed, run_benchmark, run_test_query,
    runtime_is_complete, unpack_engine, unpack_runtime, update_installed,
};
use crate::atomic::write_atomically;
use crate::manifest::{self, Backend, Network, Platform, Runtime, archive_file_name};
use crate::recommend::DriverAdvice;
use crate::setup::Setup;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallRequest {
    /// A manifest engine id.
    pub engine: String,
    /// A manifest network id, or an imported network's id from the record.
    pub network: String,
    /// The `textSha256` of every licence the user has accepted.
    pub accepted_licences: BTreeSet<String>,
    /// Run KataGo's benchmark to choose the thread count. The wizard does not: it uses the
    /// backend's default, and settings measures on request.
    pub benchmark: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallOptions {
    pub download: DownloadOptions,
    /// No benchmark output for this long is timedOut.
    pub benchmark_stall: Duration,
    pub test_query_timeout: Duration,
    /// At most one byte-progress snapshot per this interval; state changes always go out.
    pub progress_every: Duration,
}

impl Default for InstallOptions {
    fn default() -> Self {
        InstallOptions {
            download: DownloadOptions::default(),
            benchmark_stall: Duration::from_secs(5 * 60),
            test_query_timeout: Duration::from_secs(5 * 60),
            progress_every: Duration::from_millis(250),
        }
    }
}

/// What an `Installer` works with. `client` is the download client: `http_client("Aji/<version>",
/// ClientOptions { timeout: None, connect_timeout: 15 s })`. The manifest's 10 s whole-request
/// limit would cut every large download.
pub struct InstallerParts {
    pub root: InstallRoot,
    pub setup: Arc<Setup>,
    /// The engine Aji analyses with: stopped during the benchmark, switched on activation.
    pub engine: aji_engine::Engine,
    pub client: reqwest::Client,
    pub source: watch::Receiver<DownloadSource>,
    pub space: Arc<dyn FreeSpace>,
    pub options: InstallOptions,
    /// Where the engines will run: `Platform::this()` in the app. An engine for another
    /// platform is refused, and `None` refuses every engine.
    pub platform: Option<Platform>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartError {
    /// A job is running.
    Busy,
    UnknownEngine,
    UnknownNetwork,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobSnapshot {
    #[ts(type = "number")]
    pub id: u64,
    pub engine: String,
    pub backend: Backend,
    pub network: String,
    pub tasks: Vec<TaskRow>,
    pub outcome: Option<JobOutcome>,
    /// The job measures the thread count with the benchmark: settings asked for it, and shows it.
    pub measures: bool,
    /// Where the benchmark is, once it has started: the count under test and those measured.
    pub benchmark: Option<Box<BenchmarkProgress>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TaskRow {
    pub task: TaskKind,
    pub state: TaskState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TaskKind {
    Engine,
    Runtime,
    Network,
    Benchmark,
    TestQuery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum TaskState {
    Waiting,
    /// Bytes for downloads, positions across every thread count for the benchmark, 0 of 1 for
    /// the test query.
    Running {
        #[ts(type = "number")]
        done: u64,
        #[ts(type = "number")]
        total: u64,
    },
    Done,
    /// The component was already installed and verified, so nothing was downloaded.
    Reused,
    Failed {
        failure: FailureCode,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum JobOutcome {
    Installed,
    Failed {
        failure: FailureCode,
        stderr_tail: Vec<String>,
        offer: Option<FallbackOffer>,
        /// Set for `gpuDriverTooOld`: the GPU's driver and the runtime's `minDriver`.
        driver: Option<DriverAdvice>,
    },
    Cancelled,
}

/// The next backend to try after a failure, which the user may accept or not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FallbackOffer {
    pub backend: Backend,
    pub engine: String,
    #[ts(type = "number")]
    pub download_bytes: u64,
    #[ts(type = "number | null")]
    pub runtime_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LicenceInfo {
    pub name: String,
    pub url: String,
    pub text_sha256: String,
    /// What the licence covers, so the user sees each component and its size (R1 section 6).
    pub components: Vec<LicensedComponent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LicensedComponent {
    pub name: String,
    pub version: String,
    /// The archive's download size.
    #[ts(type = "number")]
    pub bytes: u64,
}

/// Runs install jobs, one at a time.
pub struct Installer {
    root: InstallRoot,
    setup: Arc<Setup>,
    engine: aji_engine::Engine,
    client: reqwest::Client,
    source: watch::Receiver<DownloadSource>,
    space: Arc<dyn FreeSpace>,
    options: InstallOptions,
    platform: Option<Platform>,
    runtime: Handle,
    on_progress: Box<dyn Fn(JobSnapshot) + Send + Sync>,
    jobs: Mutex<Jobs>,
    /// Held across every read-modify-write of `installed.json`.
    record: Mutex<()>,
    /// True while no job runs.
    idle: watch::Sender<bool>,
    /// True while a job has the GPU for its benchmark and test query.
    holds_engine: AtomicBool,
    #[cfg(feature = "test-seams")]
    panic_next: AtomicBool,
}

struct Jobs {
    next_id: u64,
    current: Option<Current>,
    last: Option<JobSnapshot>,
}

struct Current {
    snapshot: JobSnapshot,
    cancel: CancellationToken,
    throttle: Throttle,
}

/// What a job installs, resolved from the manifest when it starts.
struct Job {
    engine: manifest::Engine,
    runtime: Option<Runtime>,
    network: JobNetwork,
    accepted: BTreeSet<String>,
    benchmark: bool,
    cancel: CancellationToken,
}

enum JobNetwork {
    Manifest(Box<Network>),
    /// An imported network's id; it is already in the record.
    Imported(String),
}

impl JobNetwork {
    fn id(&self) -> &str {
        match self {
            JobNetwork::Manifest(network) => &network.id,
            JobNetwork::Imported(id) => id,
        }
    }
}

/// Why a job ended early.
enum Stop {
    Cancelled,
    Failed {
        failure: FailureCode,
        stderr_tail: Vec<String>,
        /// Whether to offer the next backend.
        offer: bool,
        /// The row that failed, if any.
        task: Option<TaskKind>,
    },
}

impl Stop {
    fn failed(failure: FailureCode, line: String, offer: bool, task: Option<TaskKind>) -> Stop {
        Stop::Failed {
            failure,
            stderr_tail: vec![line],
            offer,
            task,
        }
    }
}

impl Installer {
    /// # Panics
    /// Outside a Tokio runtime: jobs run on the runtime current here.
    pub fn new(
        parts: InstallerParts,
        on_progress: impl Fn(JobSnapshot) + Send + Sync + 'static,
    ) -> Arc<Installer> {
        Arc::new(Installer {
            root: parts.root,
            setup: parts.setup,
            engine: parts.engine,
            client: parts.client,
            source: parts.source,
            space: parts.space,
            options: parts.options,
            platform: parts.platform,
            runtime: Handle::current(),
            on_progress: Box::new(on_progress),
            jobs: Mutex::new(Jobs {
                next_id: 0,
                current: None,
                last: None,
            }),
            record: Mutex::new(()),
            idle: watch::Sender::new(true),
            holds_engine: AtomicBool::new(false),
            #[cfg(feature = "test-seams")]
            panic_next: AtomicBool::new(false),
        })
    }

    /// Makes the next job panic once it has the engine. Tests only.
    #[cfg(feature = "test-seams")]
    pub fn panic_next_job(&self) {
        self.panic_next.store(true, Ordering::SeqCst);
    }

    /// Sets what [`Installer::holds_engine`] reports. Tests only.
    #[cfg(feature = "test-seams")]
    pub fn set_holds_engine(&self, held: bool) {
        self.holds_engine.store(held, Ordering::SeqCst);
    }

    /// True while a job has stopped the engine for its benchmark and test query: restarting or
    /// resuming the engine then would skew the numbers.
    pub fn holds_engine(&self) -> bool {
        self.holds_engine.load(Ordering::SeqCst)
    }

    pub fn start(self: &Arc<Self>, request: InstallRequest) -> Result<(), StartError> {
        let selected = self.setup.manifest().current();
        let manifest = &selected.manifest;
        let engine = manifest
            .engines
            .iter()
            .find(|e| e.id == request.engine)
            .cloned()
            .filter(|e| Some(e.platform) == self.platform)
            .ok_or(StartError::UnknownEngine)?;
        let runtime = match &engine.runtime {
            None => None,
            Some(id) => Some(
                manifest
                    .runtimes
                    .iter()
                    .find(|r| &r.id == id)
                    .cloned()
                    .ok_or(StartError::UnknownEngine)?,
            ),
        };
        let network = match manifest.networks.iter().find(|n| n.id == request.network) {
            Some(network)
                if network
                    .min_engine_version
                    .as_ref()
                    .is_some_and(|min| *min > engine.version) =>
            {
                return Err(StartError::UnknownNetwork);
            }
            Some(network) => JobNetwork::Manifest(Box::new(network.clone())),
            None if self
                .installed()
                .networks
                .get(&request.network)
                .is_some_and(|n| n.imported) =>
            {
                JobNetwork::Imported(request.network.clone())
            }
            None => return Err(StartError::UnknownNetwork),
        };

        let cancel = CancellationToken::new();
        let snapshot = {
            let mut jobs = lock(&self.jobs);
            if jobs.current.is_some() {
                return Err(StartError::Busy);
            }
            jobs.next_id += 1;
            let snapshot = JobSnapshot {
                id: jobs.next_id,
                engine: engine.id.clone(),
                backend: engine.backend,
                network: network.id().to_string(),
                tasks: rows(runtime.is_some(), request.benchmark),
                outcome: None,
                measures: request.benchmark,
                benchmark: None,
            };
            jobs.current = Some(Current {
                snapshot: snapshot.clone(),
                cancel: cancel.clone(),
                throttle: Throttle::new(self.options.progress_every),
            });
            self.idle.send_replace(false);
            snapshot
        };
        eprintln!(
            "aji: install job {}: {} with {}",
            snapshot.id, snapshot.engine, snapshot.network
        );
        (self.on_progress)(snapshot);
        let job = Job {
            engine,
            runtime,
            network,
            accepted: request.accepted_licences,
            benchmark: request.benchmark,
            cancel,
        };
        self.runtime.spawn(Arc::clone(self).run(job));
        Ok(())
    }

    pub fn cancel(&self) {
        if let Some(current) = &lock(&self.jobs).current {
            current.cancel.cancel();
        }
    }

    /// The running job, or the last one.
    pub fn status(&self) -> Option<JobSnapshot> {
        let jobs = lock(&self.jobs);
        jobs.current
            .as_ref()
            .map(|c| c.snapshot.clone())
            .or_else(|| jobs.last.clone())
    }

    /// Resolves when the current job ends, at once when none runs; gives `status()`.
    pub async fn finished(&self) -> Option<JobSnapshot> {
        let mut idle = self.idle.subscribe();
        // `wait_for` fails only once the sender is gone, and `self` holds it.
        let _ = idle.wait_for(|idle| *idle).await;
        self.status()
    }

    /// The licences installing `engine` needs accepted; `None` for an unknown engine.
    pub fn licences(&self, engine: &str) -> Option<Vec<LicenceInfo>> {
        let selected = self.setup.manifest().current();
        let manifest = &selected.manifest;
        let engine = manifest.engines.iter().find(|e| e.id == engine)?;
        let Some(runtime) = &engine.runtime else {
            return Some(Vec::new());
        };
        let runtime = manifest.runtimes.iter().find(|r| &r.id == runtime)?;
        let mut licences: Vec<LicenceInfo> = Vec::new();
        for c in runtime
            .components
            .iter()
            .filter(|c| c.licence.requires_acceptance)
        {
            let component = LicensedComponent {
                name: c.name.clone(),
                version: c.version.clone(),
                bytes: c.archive.size,
            };
            match licences
                .iter_mut()
                .find(|l| l.text_sha256 == c.licence.text_sha256)
            {
                Some(licence) => licence.components.push(component),
                None => licences.push(LicenceInfo {
                    name: c.licence.name.clone(),
                    url: c.licence.url.clone(),
                    text_sha256: c.licence.text_sha256.clone(),
                    components: vec![component],
                }),
            }
        }
        Some(licences)
    }

    /// See `import_network`. Blocking: call it off the async runtime.
    pub fn import_network(&self, file: &Path) -> Result<ImportedNetwork, ImportError> {
        // The copy can take a while: only the record write holds the lock.
        let (imported, network) = super::copy_network(&self.root, file)?;
        let _record = lock(&self.record);
        super::record_network(&self.root, &imported.id, network)?;
        Ok(imported)
    }

    /// The active set, as the settings page shows it.
    pub fn active_summary(&self) -> Option<ActiveSummary> {
        super::unused::active_summary(&self.installed())
    }

    /// The bytes [`Installer::remove_unused`] would free. Blocking: it walks the folders.
    pub fn unused_bytes(&self) -> u64 {
        let installed = self.installed();
        super::unused::unused_paths(&self.root, &installed)
            .iter()
            .map(|p| super::unused::size_of(p))
            .sum()
    }

    /// Deletes everything the active set does not use and drops it from the record. Refused
    /// while a job runs, since its staging folder and part files are in use. Blocking.
    pub fn remove_unused(&self) -> Result<u64, RemoveError> {
        let jobs = lock(&self.jobs);
        if jobs.current.is_some() {
            return Err(RemoveError::Busy);
        }
        let _record = lock(&self.record);
        let path = self.root.record_file();
        // Strict: a record that cannot be read would look like one with no active set, and
        // everything, the engine in use included, would count as unused.
        let installed = super::record::read_installed(&path)
            .map_err(|e| RemoveError::Io(format!("{}: {e}", path.display())))?;
        let mut freed = 0;
        for unused in super::unused::unused_paths(&self.root, &installed) {
            let size = super::unused::size_of(&unused);
            super::unused::remove_path(&unused)
                .map_err(|e| RemoveError::Io(format!("{}: {e}", unused.display())))?;
            freed += size;
        }
        let kept = super::unused::only_used(&installed);
        update_installed(&path, |record| *record = kept)
            .map_err(|e| RemoveError::Io(format!("{}: {e}", path.display())))?;
        drop(jobs);
        Ok(freed)
    }

    pub fn installed(&self) -> Installed {
        let _record = lock(&self.record);
        load_installed(&self.root.record_file())
    }

    async fn run(self: Arc<Self>, job: Job) {
        let job = Arc::new(job);
        let was_running = engine_runs(&self.engine.state());
        let work = {
            let (this, job) = (Arc::clone(&self), Arc::clone(&job));
            self.runtime.spawn(async move { this.work(&job).await })
        };
        // A panic in the job still ends it, so the installer is never stuck busy, and the
        // engine it may have stopped runs again.
        let result = match work.await {
            Ok(result) => result,
            Err(e) => {
                self.holds_engine.store(false, Ordering::SeqCst);
                if was_running
                    && !engine_runs(&self.engine.state())
                    && let Err(e) = self.engine.restart().await
                {
                    eprintln!("aji: cannot restart the engine after the job failed: {e}");
                }
                Err(Stop::failed(
                    FailureCode::Crashed,
                    format!("aji: the install job failed: {e}"),
                    false,
                    None,
                ))
            }
        };
        let outcome = match result {
            Ok(()) => JobOutcome::Installed,
            Err(Stop::Cancelled) => JobOutcome::Cancelled,
            Err(Stop::Failed {
                failure,
                stderr_tail,
                offer,
                task,
            }) => {
                if let Some(task) = task {
                    self.set_row(task, TaskState::Failed { failure });
                }
                let offer = match offer {
                    true => self.offer_after(job.engine.backend).await,
                    false => None,
                };
                let driver = match failure {
                    FailureCode::GpuDriverTooOld => self.driver_advice(&job).await,
                    _ => None,
                };
                JobOutcome::Failed {
                    failure,
                    stderr_tail,
                    offer,
                    driver,
                }
            }
        };
        let snapshot = {
            let mut jobs = lock(&self.jobs);
            let Some(mut current) = jobs.current.take() else {
                return;
            };
            current.snapshot.outcome = Some(outcome);
            jobs.last = Some(current.snapshot.clone());
            current.snapshot
        };
        eprintln!("aji: install job {}: {:?}", snapshot.id, snapshot.outcome);
        // The outcome goes out before `finished` resolves.
        (self.on_progress)(snapshot);
        self.idle.send_replace(true);
    }

    /// The job's sequence (design 5.3 to 5.9).
    async fn work(&self, job: &Job) -> Result<(), Stop> {
        check_licences(job)?;
        let installed = self.without_missing_files(self.installed(), job);
        self.check_room(job, &installed)?;
        self.install_engine(job, &installed).await?;
        self.install_runtime(job, &installed).await?;
        self.install_network(job, &installed).await?;
        if job.cancel.is_cancelled() {
            return Err(Stop::Cancelled);
        }
        // The benchmark needs the GPU to itself.
        self.holds_engine.store(true, Ordering::SeqCst);
        let was_running = engine_runs(&self.engine.state());
        if was_running && let Err(e) = self.engine.stop().await {
            eprintln!("aji: cannot stop the running engine: {e}");
        }
        #[cfg(feature = "test-seams")]
        if self.panic_next.swap(false, Ordering::SeqCst) {
            panic!("the test seam made the job panic");
        }
        let result = match self.measure_and_test(job).await {
            Ok(set) => self.activate(set).await,
            Err(stop) => Err(stop),
        };
        if result.is_err()
            && was_running
            && let Err(e) = self.engine.restart().await
        {
            eprintln!("aji: cannot restart the engine that ran before: {e}");
        }
        self.holds_engine.store(false, Ordering::SeqCst);
        result
    }

    /// `installed` without the job's recorded components whose files are gone or damaged, so
    /// the job installs them again: after a manual delete, an antivirus quarantine or a power
    /// cut, the record alone is not trusted.
    fn without_missing_files(&self, mut installed: Installed, job: &Job) -> Installed {
        let missing = |what: &str, id: &str| {
            eprintln!(
                "aji: {what} {id} is recorded but its files are missing or damaged; \
                 installing it again"
            );
        };
        let id = &job.engine.id;
        if let Some(engine) = installed.engines.get(id)
            && !non_empty_file(&self.root.engine_dir(id).join(&engine.binary))
        {
            missing("engine", id);
            installed.engines.remove(id);
        }
        if let Some(runtime) = &job.runtime
            && installed.runtimes.contains_key(&runtime.id)
        {
            let patterns = runtime
                .components
                .iter()
                .flat_map(|c| c.extract.iter().map(String::as_str));
            if !runtime_is_complete(&self.root.runtime_dir(&runtime.id), patterns) {
                missing("runtime", &runtime.id);
                installed.runtimes.remove(&runtime.id);
            }
        }
        if let JobNetwork::Manifest(network) = &job.network
            && let Some(recorded) = installed.networks.get(&network.id)
        {
            let size = fs::metadata(self.root.network_file(&recorded.file)).map(|m| m.len());
            if size.ok() != Some(network.file.size) {
                missing("network", &network.id);
                installed.networks.remove(&network.id);
            }
        }
        installed
    }

    /// Free space for what is not recorded yet, with the plan's estimates: 4 × an engine zip,
    /// 2.5 × each runtime archive, 1 × a network. A network that does not fit alone offers
    /// nothing, since every backend needs it.
    fn check_room(&self, job: &Job, installed: &Installed) -> Result<(), Stop> {
        let network = match &job.network {
            JobNetwork::Manifest(n) if !installed.networks.contains_key(&n.id) => n.file.size,
            _ => 0,
        };
        let short = |e: NotEnoughSpace, offer: bool| {
            Stop::failed(FailureCode::NotEnoughSpace, space_line(&e), offer, None)
        };
        check_space(&*self.space, self.root.root(), network).map_err(|e| short(e, false))?;
        let mut need = network;
        if !installed.engines.contains_key(&job.engine.id) {
            need = need.saturating_add(job.engine.file.size.saturating_mul(4));
        }
        if let Some(runtime) = &job.runtime
            && !installed.runtimes.contains_key(&runtime.id)
        {
            for c in &runtime.components {
                need = need.saturating_add(c.archive.size.saturating_mul(5) / 2);
            }
        }
        check_space(&*self.space, self.root.root(), need).map_err(|e| short(e, true))
    }

    async fn install_engine(&self, job: &Job, installed: &Installed) -> Result<(), Stop> {
        let engine = &job.engine;
        if installed.engines.contains_key(&engine.id) {
            self.set_row(TaskKind::Engine, TaskState::Reused);
            return Ok(());
        }
        let item = DownloadItem {
            name: engine.file.name.clone(),
            size: engine.file.size,
            digest: engine.file.digest.clone(),
            urls: engine.file.urls.clone(),
            origin: Origin::Package,
        };
        let zip = self
            .download(job, TaskKind::Engine, &item, 0, item.size, true)
            .await?;
        let (root, id, from) = (self.root.clone(), engine.id.clone(), zip.clone());
        let binary = blocking(move || unpack_engine(&from, &root, &id))
            .await
            .map_err(|e| {
                unpack_stop(
                    &e,
                    format!("aji: cannot unpack {}: {e:?}", item.name),
                    Some(TaskKind::Engine),
                )
            })?;
        self.write_record(|r| {
            r.engines.insert(
                engine.id.clone(),
                InstalledEngine {
                    backend: engine.backend,
                    version: engine.version.to_string(),
                    binary,
                },
            );
        })
        .map_err(|line| disk_stop(line, Some(TaskKind::Engine)))?;
        remove_download(&zip);
        self.set_row(TaskKind::Engine, TaskState::Done);
        Ok(())
    }

    async fn install_runtime(&self, job: &Job, installed: &Installed) -> Result<(), Stop> {
        let Some(runtime) = &job.runtime else {
            return Ok(());
        };
        if installed.runtimes.contains_key(&runtime.id) {
            self.set_row(TaskKind::Runtime, TaskState::Reused);
            return Ok(());
        }
        let total = runtime.components.iter().map(|c| c.archive.size).sum();
        let mut archives = Vec::new();
        let mut done = 0;
        for c in &runtime.components {
            if job.cancel.is_cancelled() {
                return Err(Stop::Cancelled);
            }
            let item = DownloadItem {
                name: archive_file_name(&c.archive.path).to_string(),
                size: c.archive.size,
                digest: c.archive.digest.clone(),
                urls: c
                    .hosts
                    .iter()
                    .map(|h| host_url(h, &c.archive.path))
                    .collect(),
                origin: Origin::Nvidia,
            };
            let path = self
                .download(job, TaskKind::Runtime, &item, done, total, true)
                .await?;
            done += item.size;
            archives.push((path, c.extract.clone()));
        }
        let fail = |failure: FailureCode, line: String| {
            Stop::failed(failure, line, true, Some(TaskKind::Runtime))
        };
        let listed = archives.clone();
        let unpacked = blocking(move || {
            listed
                .iter()
                .map(|(zip, patterns)| extract_size(zip, Some(patterns)))
                .sum::<Result<u64, _>>()
        })
        .await
        .map_err(|e| {
            fail(
                FailureCode::UnpackFailed,
                format!("aji: cannot read {}: {e:?}", runtime.id),
            )
        })?;
        check_space(&*self.space, self.root.root(), unpacked)
            .map_err(|e| fail(FailureCode::NotEnoughSpace, space_line(&e)))?;
        let (root, id, list) = (self.root.clone(), runtime.id.clone(), archives.clone());
        blocking(move || unpack_runtime(&list, &root, &id))
            .await
            .map_err(|e| {
                unpack_stop(
                    &e,
                    format!("aji: cannot unpack {}: {e:?}", runtime.id),
                    Some(TaskKind::Runtime),
                )
            })?;
        let names = archives
            .iter()
            .filter_map(|(zip, _)| zip.file_name())
            .map(|name| name.to_string_lossy().into_owned())
            .collect();
        self.write_record(|r| {
            r.runtimes
                .insert(runtime.id.clone(), InstalledRuntime { archives: names });
        })
        .map_err(|line| disk_stop(line, Some(TaskKind::Runtime)))?;
        for (zip, _) in &archives {
            remove_download(zip);
        }
        self.set_row(TaskKind::Runtime, TaskState::Done);
        Ok(())
    }

    /// A failed network offers nothing: every backend needs the network.
    async fn install_network(&self, job: &Job, installed: &Installed) -> Result<(), Stop> {
        let network = match &job.network {
            JobNetwork::Manifest(n) if !installed.networks.contains_key(&n.id) => n,
            _ => {
                self.set_row(TaskKind::Network, TaskState::Reused);
                return Ok(());
            }
        };
        if job.cancel.is_cancelled() {
            return Err(Stop::Cancelled);
        }
        let item = DownloadItem {
            name: network.file.name.clone(),
            size: network.file.size,
            digest: network.file.digest.clone(),
            urls: network.file.urls.clone(),
            origin: Origin::Package,
        };
        let path = self
            .download(job, TaskKind::Network, &item, 0, item.size, false)
            .await?;
        let fail = |line: String| disk_stop(line, Some(TaskKind::Network));
        let dest = self.root.network_file(&network.file.name);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| fail(format!("aji: {}: {e}", parent.display())))?;
        }
        fs::rename(&path, &dest).map_err(|e| fail(format!("aji: {}: {e}", dest.display())))?;
        self.write_record(|r| {
            r.networks.insert(
                network.id.clone(),
                InstalledNetwork {
                    file: network.file.name.clone(),
                    name: network.id.clone(),
                    imported: false,
                },
            );
        })
        .map_err(fail)?;
        self.set_row(TaskKind::Network, TaskState::Done);
        Ok(())
    }

    /// The benchmark when the request asked for one, else the backend's default thread count,
    /// then the test query; gives the set to activate.
    async fn measure_and_test(&self, job: &Job) -> Result<EngineSet, Stop> {
        let (engine, network) = (job.engine.id.as_str(), job.network.id());
        let installed = self.installed();
        let cores = self.setup.hardware().await.cpu.cores;
        let mut set = EngineSet {
            engine: engine.to_string(),
            network: network.to_string(),
            runtime: job.runtime.as_ref().map(|r| r.id.clone()),
            config: String::new(),
            threads: 0,
            benchmark: Vec::new(),
            name: None,
        };
        let (threads, speeds) = if job.benchmark {
            self.measure(job, &installed, &set, cores).await?
        } else {
            (default_threads(job.engine.backend, cores), Vec::new())
        };

        self.set_row(
            TaskKind::TestQuery,
            TaskState::Running { done: 0, total: 1 },
        );
        // The test runs on a pending copy: the active set's config, when this is the same set,
        // stays untouched until the test passes (`activate` renames it into place).
        let pending_rel = self.root.pending_config_rel(engine, network);
        self.write_config(&pending_rel, &analysis_config(threads, &job.engine.config))
            .map_err(|line| disk_stop(line, Some(TaskKind::TestQuery)))?;
        set.config = slashed(&pending_rel);
        set.threads = threads;
        set.benchmark = speeds;
        let files = engine_files(&self.root, &installed, &set)
            .ok_or_else(|| unrecorded(TaskKind::TestQuery))?;
        tokio::select! {
            biased;
            () = job.cancel.cancelled() => return Err(Stop::Cancelled),
            result = run_test_query(files, self.options.test_query_timeout) => {
                result.map_err(|f| Stop::Failed {
                    failure: f.code,
                    stderr_tail: f.stderr_tail,
                    offer: true,
                    task: Some(TaskKind::TestQuery),
                })?;
            }
        }
        self.set_row(TaskKind::TestQuery, TaskState::Done);
        Ok(set)
    }

    /// KataGo's benchmark over the plan's thread counts, with its progress in the snapshots;
    /// gives the chosen count and every speed measured.
    async fn measure(
        &self,
        job: &Job,
        installed: &Installed,
        set: &EngineSet,
        cores: u32,
    ) -> Result<(u32, Vec<ThreadSpeed>), Stop> {
        let (engine, network) = (set.engine.as_str(), set.network.as_str());
        let plan = benchmark_plan(job.engine.backend, cores);
        // Positions across every count, so the bar moves while KataGo measures.
        let positions = u64::from(plan.positions);
        let total = plan.threads.len() as u64 * positions;
        self.set_row(TaskKind::Benchmark, TaskState::Running { done: 0, total });
        let benchmark_rel = self.root.benchmark_config_rel(engine, network);
        self.write_config(&benchmark_rel, &benchmark_config(&plan, &job.engine.config))
            .map_err(|line| disk_stop(line, Some(TaskKind::Benchmark)))?;
        let measured = EngineSet {
            config: slashed(&benchmark_rel),
            ..set.clone()
        };
        let files = engine_files(&self.root, installed, &measured)
            .ok_or_else(|| unrecorded(TaskKind::Benchmark))?;
        let mut on_progress =
            |progress: BenchmarkProgress| self.benchmark_progress(progress, positions, total);
        let speeds = tokio::select! {
            biased;
            () = job.cancel.cancelled() => return Err(Stop::Cancelled),
            result = run_benchmark(&files, &plan, self.options.benchmark_stall, &mut on_progress) => {
                result.map_err(|f| Stop::Failed {
                    failure: f.code,
                    stderr_tail: f.stderr_tail,
                    offer: true,
                    task: Some(TaskKind::Benchmark),
                })?
            }
        };
        let threads = choose_threads(&speeds).unwrap_or(plan.threads[0]);
        eprintln!("aji: {engine} runs {threads} threads: {speeds:?}");
        self.set_row(TaskKind::Benchmark, TaskState::Done);
        Ok((threads, speeds))
    }

    /// Records the set as active, then switches the running engine to it. Past the test query
    /// a cancel no longer applies.
    async fn activate(&self, mut set: EngineSet) -> Result<(), Stop> {
        let config_rel = self.root.config_rel(&set.engine, &set.network);
        let pending = self
            .root
            .root()
            .join(self.root.pending_config_rel(&set.engine, &set.network));
        let config = self.root.root().join(&config_rel);
        fs::rename(&pending, &config).map_err(|e| {
            disk_stop(
                format!("aji: cannot move {} into place: {e}", config.display()),
                None,
            )
        })?;
        set.config = slashed(&config_rel);
        let key = set.key();
        let record = self
            .write_record(|r| {
                r.put_set(set.clone());
                r.active = Some(key);
            })
            .map_err(|line| disk_stop(line, None))?;
        match engine_files(&self.root, &record, &set) {
            Some(files) => {
                let identity = aji_engine::identity_for(&files).await;
                if let Err(e) = self.engine.set_files(Some(files), identity).await {
                    eprintln!("aji: cannot switch the engine to the new set: {e}");
                }
            }
            None => eprintln!("aji: the new set names a component that is not recorded"),
        }
        Ok(())
    }

    /// `item` into `downloads/`, reporting into `task`'s row from `base` of `total` bytes.
    async fn download(
        &self,
        job: &Job,
        task: TaskKind,
        item: &DownloadItem,
        base: u64,
        total: u64,
        offer: bool,
    ) -> Result<PathBuf, Stop> {
        self.set_row(task, TaskState::Running { done: base, total });
        let downloader = Downloader::new(
            self.client.clone(),
            self.options.download.clone(),
            self.source.clone(),
        );
        let mut progress = |done: u64, _size: u64| self.progress(task, base + done, total);
        let fail =
            |failure: FailureCode, line: String| Stop::failed(failure, line, offer, Some(task));
        match downloader
            .fetch(item, &self.root.downloads_dir(), &job.cancel, &mut progress)
            .await
        {
            Ok(path) => Ok(path),
            Err(DownloadError::Cancelled) => Err(Stop::Cancelled),
            Err(DownloadError::Failed { last }) => Err(fail(
                FailureCode::DownloadFailed,
                format!("aji: cannot download {}: {last}", item.name),
            )),
            Err(DownloadError::Checksum) => Err(fail(
                FailureCode::ChecksumMismatch,
                format!(
                    "aji: {} does not match its checksum from any URL",
                    item.name
                ),
            )),
            Err(DownloadError::Io(e)) => Err(fail(
                FailureCode::DownloadFailed,
                format!("aji: cannot write {}: {e}", item.name),
            )),
        }
    }

    /// Reads, changes and saves `installed.json` under the record lock.
    fn write_record(&self, change: impl FnOnce(&mut Installed)) -> Result<Installed, String> {
        let _record = lock(&self.record);
        let path = self.root.record_file();
        update_installed(&path, change)
            .map_err(|e| format!("aji: cannot update {}: {e}", path.display()))
    }

    fn write_config(&self, rel: &Path, text: &str) -> Result<(), String> {
        let path = self.root.root().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("aji: cannot create {}: {e}", parent.display()))?;
        }
        write_atomically(&path, text.as_bytes())
            .map_err(|e| format!("aji: cannot write {}: {e}", path.display()))
    }

    /// The GPU's driver and the job's runtime `minDriver`, when the runtime names one.
    async fn driver_advice(&self, job: &Job) -> Option<DriverAdvice> {
        let required = job.runtime.as_ref()?.min_driver.clone()?;
        let current = self
            .setup
            .backends()
            .await
            .gpu
            .and_then(|gpu| gpu.driver_version);
        Some(DriverAdvice { current, required })
    }

    /// The first backend after `failed` in the recommendation (`default`, then `fallbacks`)
    /// that has an engine. A backend the recommendation does not list is followed by every one
    /// it does.
    async fn offer_after(&self, failed: Backend) -> Option<FallbackOffer> {
        let recommendation = self.setup.backends().await;
        let order: Vec<Backend> = recommendation
            .default
            .into_iter()
            .chain(recommendation.fallbacks)
            .collect();
        let after = match order.iter().position(|b| *b == failed) {
            Some(i) => order[i + 1..].to_vec(),
            None => order,
        };
        for backend in after.into_iter().filter(|b| *b != failed) {
            if let Some(choice) = self.setup.versions(backend).await.into_iter().next() {
                return Some(FallbackOffer {
                    backend,
                    engine: choice.engine,
                    download_bytes: choice.download_bytes,
                    runtime_bytes: choice.runtime_bytes,
                });
            }
        }
        None
    }

    /// A state change: always reported.
    fn set_row(&self, task: TaskKind, state: TaskState) {
        self.update(task, state, true);
    }

    /// Bytes or counts done: reported at most once per `progress_every`.
    fn progress(&self, task: TaskKind, done: u64, total: u64) {
        self.update(task, TaskState::Running { done, total }, false);
    }

    /// The benchmark's progress and its row. A new count under test, or a new result, always
    /// goes out; positions within a count follow `progress_every`.
    fn benchmark_progress(&self, progress: BenchmarkProgress, positions: u64, total: u64) {
        let done = (progress.tested.len() as u64 * positions + u64::from(progress.positions_done))
            .min(total);
        let emit = {
            let mut jobs = lock(&self.jobs);
            let Some(current) = jobs.current.as_mut() else {
                return;
            };
            let snapshot = &mut current.snapshot;
            // A new count under test, or a count just measured, is a change of stage.
            let always = snapshot
                .benchmark
                .as_ref()
                .is_none_or(|b| b.testing != progress.testing || b.tested != progress.tested);
            if let Some(row) = snapshot
                .tasks
                .iter_mut()
                .find(|r| r.task == TaskKind::Benchmark)
            {
                row.state = TaskState::Running { done, total };
            }
            snapshot.benchmark = Some(Box::new(progress));
            current
                .throttle
                .admit(Instant::now(), always)
                .then(|| current.snapshot.clone())
        };
        if let Some(snapshot) = emit {
            (self.on_progress)(snapshot);
        }
    }

    fn update(&self, task: TaskKind, state: TaskState, always: bool) {
        let emit = {
            let mut jobs = lock(&self.jobs);
            let Some(current) = jobs.current.as_mut() else {
                return;
            };
            if let Some(row) = current.snapshot.tasks.iter_mut().find(|r| r.task == task) {
                row.state = state;
            }
            current
                .throttle
                .admit(Instant::now(), always)
                .then(|| current.snapshot.clone())
        };
        if let Some(snapshot) = emit {
            (self.on_progress)(snapshot);
        }
    }
}

fn engine_runs(state: &EngineState) -> bool {
    matches!(
        state,
        EngineState::Starting
            | EngineState::Ready { .. }
            | EngineState::Analysing { .. }
            | EngineState::Paused { .. }
    )
}

/// A failed write inside the install root: no other backend would fare better.
fn disk_stop(line: String, task: Option<TaskKind>) -> Stop {
    Stop::failed(FailureCode::DiskError, line, false, task)
}

/// An unpack failure: a disk error when the file system refused, else the package's fault,
/// which another backend's package may not share.
fn unpack_stop(error: &UnpackError, line: String, task: Option<TaskKind>) -> Stop {
    match error {
        UnpackError::Io(_) => disk_stop(line, task),
        _ => Stop::failed(FailureCode::UnpackFailed, line, true, task),
    }
}

/// Every `requiresAcceptance` licence of the runtime must be accepted before any request.
fn check_licences(job: &Job) -> Result<(), Stop> {
    let Some(runtime) = &job.runtime else {
        return Ok(());
    };
    let missing: Vec<String> = runtime
        .components
        .iter()
        .map(|c| &c.licence)
        .filter(|l| l.requires_acceptance && !job.accepted.contains(&l.text_sha256))
        .map(|l| format!("aji: the licence {} is not accepted", l.name))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    Err(Stop::Failed {
        failure: FailureCode::LicenceNotAccepted,
        stderr_tail: missing,
        offer: true,
        task: None,
    })
}

/// The rows in order: engine, runtime (when there is one), network, benchmark, test query.
fn non_empty_file(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() > 0)
}

/// A set naming a component the record does not have: a fault in Aji, not in the download.
fn unrecorded(task: TaskKind) -> Stop {
    Stop::failed(
        FailureCode::Crashed,
        "aji: the engine set names a component that is not recorded".into(),
        true,
        Some(task),
    )
}

fn rows(runtime: bool, benchmark: bool) -> Vec<TaskRow> {
    [
        Some(TaskKind::Engine),
        runtime.then_some(TaskKind::Runtime),
        Some(TaskKind::Network),
        benchmark.then_some(TaskKind::Benchmark),
        Some(TaskKind::TestQuery),
    ]
    .into_iter()
    .flatten()
    .map(|task| TaskRow {
        task,
        state: TaskState::Waiting,
    })
    .collect()
}

fn space_line(e: &NotEnoughSpace) -> String {
    format!(
        "aji: {} bytes are needed and {} are free",
        e.need, e.available
    )
}

/// `host` and the archive's relative `path`, with one `/` between them.
fn host_url(host: &str, path: &str) -> String {
    format!(
        "{}/{}",
        host.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

/// A path relative to the root with `/` separators, as the record keeps it on every OS.
fn slashed(rel: &Path) -> String {
    rel.iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn remove_download(path: &Path) {
    if let Err(e) = fs::remove_file(path)
        && e.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!("aji: cannot remove {}: {e}", path.display());
    }
}

/// Runs blocking file work off the async threads; a panic there carries on here.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    tokio::task::spawn_blocking(work)
        .await
        .unwrap_or_else(|e| std::panic::resume_unwind(e.into_panic()))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn the_snapshot_serialises_in_camel_case() {
        let outcome = JobOutcome::Failed {
            failure: FailureCode::OutOfMemory,
            stderr_tail: vec!["x".into()],
            offer: Some(FallbackOffer {
                backend: Backend::Eigenavx2,
                engine: "e".into(),
                download_bytes: 1,
                runtime_bytes: None,
            }),
            driver: Some(DriverAdvice {
                current: None,
                required: "580.00".into(),
            }),
        };
        assert_eq!(
            serde_json::to_value(&outcome).unwrap(),
            json!({
                "outcome": "failed",
                "failure": "outOfMemory",
                "stderrTail": ["x"],
                "offer": {
                    "backend": "eigenavx2",
                    "engine": "e",
                    "downloadBytes": 1,
                    "runtimeBytes": null
                },
                "driver": { "current": null, "required": "580.00" }
            })
        );
        assert_eq!(
            serde_json::to_value(TaskState::Reused).unwrap(),
            json!({"state": "reused"})
        );
        let row = TaskRow {
            task: TaskKind::TestQuery,
            state: TaskState::Running { done: 0, total: 1 },
        };
        assert_eq!(
            serde_json::to_value(&row).unwrap(),
            json!({ "task": "testQuery", "state": { "state": "running", "done": 0, "total": 1 } })
        );
        assert_eq!(
            serde_json::to_value(JobOutcome::Cancelled).unwrap(),
            json!({ "outcome": "cancelled" })
        );
    }

    #[test]
    fn rows_follow_the_job_order() {
        let kinds = |runtime| {
            rows(runtime, true)
                .into_iter()
                .map(|r| r.task)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            kinds(true),
            [
                TaskKind::Engine,
                TaskKind::Runtime,
                TaskKind::Network,
                TaskKind::Benchmark,
                TaskKind::TestQuery
            ]
        );
        assert!(!kinds(false).contains(&TaskKind::Runtime));
        assert!(
            !rows(true, false)
                .iter()
                .any(|r| r.task == TaskKind::Benchmark)
        );
    }

    #[test]
    fn urls_and_paths_use_one_slash() {
        assert_eq!(
            host_url("https://h.example/", "a/b.zip"),
            "https://h.example/a/b.zip"
        );
        assert_eq!(
            host_url("https://h.example", "a/b.zip"),
            "https://h.example/a/b.zip"
        );
        let rel: PathBuf = ["configs", "e+n.cfg"].iter().collect();
        assert_eq!(slashed(&rel), "configs/e+n.cfg");
    }
}
