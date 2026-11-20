//! The dispatcher behind every transport. It knows nothing about Tauri, so the WebSocket server of
//! Phase 3 can call the same [`handle`] with the same messages.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use aji_engine::{Engine, EngineError, EngineEvent, EngineFiles};
use aji_manager::Setup;
use aji_manager::install::{
    DownloadSource, ImportError, InstallRequest, InstallRoot, Installed, Installer, RemoveError,
    StartError, engine_files,
};
use tokio::sync::watch;

use crate::protocol::{AppEvent, AppInfo, ErrorCode, OsKind, ProtocolError, Request, Response};
use crate::settings::{
    Settings, UiSettings, load_settings, record_accepted_licences, save_ui_settings,
    update_settings,
};

/// Facts about this installation, and the services, that requests may need.
#[derive(Clone)]
pub struct AppContext {
    pub version: String,
    pub os: OsKind,
    pub arch: String,
    pub engine: Engine,
    pub setup: Arc<Setup>,
    pub installer: Arc<Installer>,
    pub settings_path: PathBuf,
    pub files: Arc<dyn FilePicker>,
    /// The download source the installer reads; `setupSetDownloadSource` changes it.
    pub source: watch::Sender<DownloadSource>,
    /// Where events go, for those a request causes (`settingsChanged`).
    pub events: Arc<dyn EventSink>,
}

/// Asks the user for a file. Blocking: call it through `spawn_blocking`.
pub trait FilePicker: Send + Sync {
    /// A KataGo network file, or `None` when the user cancels.
    fn pick_network(&self) -> Option<PathBuf>;
}

/// The files the engine starts with: the development engine named in the settings, else the
/// active installed set, else none.
pub fn startup_files(
    settings: &Settings,
    installed: &Installed,
    root: &InstallRoot,
) -> Option<EngineFiles> {
    if let Some(dev) = &settings.dev_engine {
        return Some(dev.files());
    }
    engine_files(root, installed, installed.active_set()?)
}

/// Where pushed events go: the Tauri webview now, a WebSocket in Phase 3.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: AppEvent);
}

/// The callback to give `Engine::spawn`: it turns engine events into [`AppEvent`]s for `sink`.
pub fn forward_engine_events(
    sink: Arc<dyn EventSink>,
) -> impl Fn(EngineEvent) + Send + Sync + 'static {
    move |event| {
        sink.emit(match event {
            EngineEvent::State(engine) => AppEvent::EngineState { engine },
            EngineEvent::Analysis(analysis) => AppEvent::AnalysisUpdate { analysis },
        });
    }
}

impl From<EngineError> for ProtocolError {
    fn from(error: EngineError) -> Self {
        let code = match error {
            EngineError::NotConfigured => ErrorCode::EngineNotConfigured,
            EngineError::NotRunning => ErrorCode::EngineNotRunning,
            EngineError::InvalidPosition => ErrorCode::Internal,
        };
        ProtocolError {
            code,
            message: error.to_string(),
        }
    }
}

pub async fn handle(ctx: &AppContext, request: Request) -> Result<Response, ProtocolError> {
    match request {
        Request::AppInfo => Ok(Response::AppInfo(AppInfo {
            version: ctx.version.clone(),
            os: ctx.os,
            arch: ctx.arch.clone(),
        })),
        Request::EngineStatus => {
            let status = ctx.engine.status();
            Ok(Response::EngineStatus {
                engine: status.state,
                position: status.position,
                analysis: status.analysis,
            })
        }
        Request::EngineRestart => {
            refuse_while_held(ctx)?;
            ctx.engine.restart().await.map(|()| Response::Ok)
        }
        Request::EngineStop => ctx.engine.stop().await.map(|()| Response::Ok),
        Request::AnalysisPause => ctx.engine.pause().await.map(|()| Response::Ok),
        Request::AnalysisResume => {
            refuse_while_held(ctx)?;
            ctx.engine.resume().await.map(|()| Response::Ok)
        }
        Request::SetupDetect { refresh } => Ok(Response::SetupDetect {
            hardware: match refresh {
                true => ctx.setup.refresh().await,
                false => ctx.setup.hardware().await,
            },
        }),
        Request::SetupBackends => Ok(Response::SetupBackends {
            recommendation: ctx.setup.backends().await,
        }),
        Request::SetupVersions { backend } => {
            let installed = ctx.installer.installed();
            let mut versions = ctx.setup.versions(backend).await;
            for choice in &mut versions {
                choice.installed = installed.engines.contains_key(&choice.engine);
            }
            Ok(Response::SetupVersions { versions })
        }
        Request::SetupNetworks { engine } => {
            let Some(mut networks) = ctx.setup.networks(&engine).await else {
                return Err(unknown_engine(&engine));
            };
            let installed = ctx.installer.installed();
            for choice in networks.networks.iter_mut().chain(networks.human.as_mut()) {
                choice.installed = installed.networks.contains_key(&choice.network);
            }
            Ok(Response::SetupNetworks { networks })
        }
        Request::SetupLicences { engine } => return setup_licences(ctx, &engine),
        Request::SetupInstall {
            engine,
            network,
            accept_licences,
        } => return setup_install(ctx, engine, network, accept_licences),
        Request::SetupCancel => {
            ctx.installer.cancel();
            Ok(Response::Ok)
        }
        Request::SetupStatus => Ok(Response::SetupStatus {
            job: ctx.installer.status(),
        }),
        Request::SetupSetDownloadSource { source } => return set_download_source(ctx, source),
        Request::SetupImportNetwork => return import_network(ctx).await,
        Request::SetupInstalled => return setup_installed(ctx).await,
        Request::SetupRemoveUnused => return remove_unused(ctx).await,
        Request::SettingsGet => Ok(Response::Settings {
            settings: load_settings(&ctx.settings_path)
                .map(|s| s.ui)
                .unwrap_or_default(),
        }),
        Request::SettingsSet { settings } => return set_settings(ctx, settings).await,
    }
    .map_err(Into::into)
}

/// Restart and resume would take the GPU back from a job's benchmark or test query.
fn refuse_while_held(ctx: &AppContext) -> Result<(), ProtocolError> {
    match ctx.installer.holds_engine() {
        true => Err(error(
            ErrorCode::EngineBusy,
            "an install job is measuring the engine",
        )),
        false => Ok(()),
    }
}

/// Saves the preferences, hands the visit limit to the engine, and tells every client.
async fn set_settings(ctx: &AppContext, settings: UiSettings) -> Result<Response, ProtocolError> {
    save_ui_settings(&ctx.settings_path, &settings)
        .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
    ctx.engine.set_visit_limit(settings.visit_limit).await?;
    ctx.events.emit(AppEvent::SettingsChanged {
        settings: settings.clone(),
    });
    Ok(Response::Settings { settings })
}

/// Walking the install folders blocks, so it runs on the blocking pool.
async fn setup_installed(ctx: &AppContext) -> Result<Response, ProtocolError> {
    let installer = Arc::clone(&ctx.installer);
    tokio::task::spawn_blocking(move || Response::SetupInstalled {
        active: installer.active_summary(),
        unused_bytes: installer.unused_bytes(),
    })
    .await
    .map_err(|e| error(ErrorCode::Internal, e.to_string()))
}

async fn remove_unused(ctx: &AppContext) -> Result<Response, ProtocolError> {
    let installer = Arc::clone(&ctx.installer);
    match tokio::task::spawn_blocking(move || installer.remove_unused()).await {
        Ok(Ok(freed_bytes)) => Ok(Response::SetupRemoved { freed_bytes }),
        Ok(Err(RemoveError::Busy)) => Err(error(ErrorCode::SetupBusy, "an install job is running")),
        Ok(Err(RemoveError::Io(e))) => Err(error(ErrorCode::Internal, e)),
        Err(e) => Err(error(ErrorCode::Internal, e.to_string())),
    }
}

fn error(code: ErrorCode, message: impl Into<String>) -> ProtocolError {
    ProtocolError {
        code,
        message: message.into(),
    }
}

fn unknown_engine(engine: &str) -> ProtocolError {
    error(
        ErrorCode::SetupUnknownEngine,
        format!("no engine {engine} in the manifest"),
    )
}

/// The licence hashes the settings record as accepted. Unreadable settings accept nothing, so
/// the user is asked again.
fn accepted_licences(path: &Path) -> BTreeSet<String> {
    match load_settings(path) {
        Ok(settings) => settings.accepted_licences.into_keys().collect(),
        Err(e) => {
            eprintln!("aji: reading the accepted licences: {e}");
            BTreeSet::new()
        }
    }
}

fn setup_licences(ctx: &AppContext, engine: &str) -> Result<Response, ProtocolError> {
    let licences = ctx
        .installer
        .licences(engine)
        .ok_or_else(|| unknown_engine(engine))?;
    let accepted = accepted_licences(&ctx.settings_path);
    let accepted = licences
        .iter()
        .filter(|l| accepted.contains(&l.text_sha256))
        .map(|l| l.text_sha256.clone())
        .collect();
    Ok(Response::SetupLicences { licences, accepted })
}

/// Records the newly accepted licences of `engine`, then starts the job with every licence
/// accepted so far. Hashes that are not `engine`'s licences are ignored. The acceptance stays
/// recorded when the job then cannot start.
fn setup_install(
    ctx: &AppContext,
    engine: String,
    network: String,
    accept_licences: Vec<String>,
) -> Result<Response, ProtocolError> {
    let licences = ctx
        .installer
        .licences(&engine)
        .ok_or_else(|| unknown_engine(&engine))?;
    let fresh: Vec<String> = accept_licences
        .into_iter()
        .filter(|hash| licences.iter().any(|l| &l.text_sha256 == hash))
        .collect();
    if !fresh.is_empty() {
        record_accepted_licences(&ctx.settings_path, &fresh)
            .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
    }
    let mut accepted = accepted_licences(&ctx.settings_path);
    accepted.extend(fresh);
    let request = InstallRequest {
        engine,
        network,
        accepted_licences: accepted,
    };
    match ctx.installer.start(request.clone()) {
        Ok(()) => Ok(Response::Ok),
        Err(StartError::Busy) => Err(error(
            ErrorCode::SetupBusy,
            "an install job is already running",
        )),
        Err(StartError::UnknownEngine) => Err(unknown_engine(&request.engine)),
        Err(StartError::UnknownNetwork) => Err(error(
            ErrorCode::SetupUnknownNetwork,
            format!(
                "no network {} in the manifest or the record",
                request.network
            ),
        )),
    }
}

/// Writes the source to the settings, then hands it to the installer, which applies it from
/// the next download attempt on.
fn set_download_source(
    ctx: &AppContext,
    source: DownloadSource,
) -> Result<Response, ProtocolError> {
    source
        .validate()
        .map_err(|e| error(ErrorCode::SetupInvalidSource, e))?;
    let value =
        serde_json::to_value(&source).map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
    update_settings(&ctx.settings_path, |map| {
        map.insert("downloadSource".into(), value);
    })
    .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
    ctx.source.send_replace(source);
    Ok(Response::Ok)
}

/// Opens the file dialog, then copies the chosen file into the install root. Both block, so
/// both run on the blocking pool.
async fn import_network(ctx: &AppContext) -> Result<Response, ProtocolError> {
    let internal = |e: tokio::task::JoinError| error(ErrorCode::Internal, e.to_string());
    let files = Arc::clone(&ctx.files);
    let picked = tokio::task::spawn_blocking(move || files.pick_network())
        .await
        .map_err(internal)?;
    let Some(file) = picked else {
        return Ok(Response::SetupImportNetwork { network: None });
    };
    let installer = Arc::clone(&ctx.installer);
    let imported = tokio::task::spawn_blocking(move || installer.import_network(&file))
        .await
        .map_err(internal)?;
    match imported {
        Ok(network) => Ok(Response::SetupImportNetwork {
            network: Some(network),
        }),
        Err(ImportError::NotGzip) => Err(error(
            ErrorCode::SetupImportFailed,
            "the file is not gzip-compressed",
        )),
        // Reading or copying failed: not the file's fault, so not `setupImportFailed`'s text.
        Err(ImportError::Io(e)) => Err(error(ErrorCode::Internal, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use aji_engine::EngineState;
    use aji_manager::install::{
        EngineSet, FailureCode, InstalledEngine, InstalledNetwork, JobOutcome, engine_files,
        save_installed,
    };
    use aji_manager::manifest::Backend;

    use crate::settings::{DevEngine, Settings, load_settings};
    use crate::test_support::{apple_m5, installer, setup, unconfigured};

    /// The dialog's answer: a file, or `None` for a cancelled dialog.
    struct Picks(Option<PathBuf>);

    impl FilePicker for Picks {
        fn pick_network(&self) -> Option<PathBuf> {
            self.0.clone()
        }
    }

    /// A context whose install root and `settings.json` live in `dir`. Must run on a Tokio
    /// runtime: the installer runs its jobs there.
    fn ctx_in(dir: &Path, picks: Option<PathBuf>) -> AppContext {
        let setup = setup(apple_m5());
        let engine = unconfigured();
        let source = watch::Sender::new(DownloadSource::Direct);
        let installer = installer(
            &dir.join("data"),
            Arc::clone(&setup),
            engine.clone(),
            source.subscribe(),
        );
        AppContext {
            version: "0.1.0".into(),
            os: OsKind::Macos,
            arch: "aarch64".into(),
            engine,
            setup,
            installer,
            settings_path: dir.join("config").join("settings.json"),
            files: Arc::new(Picks(picks)),
            source,
            events: Arc::new(Recorded::default()),
        }
    }

    /// Keeps every event, for tests that check what a request emits.
    #[derive(Default)]
    struct Recorded(Mutex<Vec<AppEvent>>);

    impl EventSink for Recorded {
        fn emit(&self, event: AppEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    /// A context whose folders are never written.
    fn ctx() -> AppContext {
        ctx_in(Path::new("no-such-aji-folder"), None)
    }

    fn settings_json(ctx: &AppContext) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(&ctx.settings_path).unwrap()).unwrap()
    }

    const CUDA_ENGINE: &str = "katago-v1.18.2-cuda12.8-cudnn9.8.0-windows-x64";
    const NETWORK: &str = "kata1-tf3-b11c768-s12382M-d6533M";
    const CUDA_EULA: &str = "e2c71babfd18a8e69542dd7e9ca018f9caa438094001a58e6bc4d8c999bf0d07";

    #[tokio::test]
    async fn setup_status_is_empty_before_any_job() {
        assert_eq!(
            handle(&ctx(), Request::SetupStatus).await,
            Ok(Response::SetupStatus { job: None })
        );
    }

    #[tokio::test]
    async fn setup_install_with_an_unknown_engine_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let error = handle(
            &ctx,
            Request::SetupInstall {
                engine: "nope".into(),
                network: NETWORK.into(),
                accept_licences: vec![CUDA_EULA.into()],
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupUnknownEngine);
        assert_eq!(
            handle(&ctx, Request::SetupStatus).await,
            Ok(Response::SetupStatus { job: None })
        );
        assert!(
            !ctx.settings_path.exists(),
            "nothing is recorded for an unknown engine"
        );
    }

    #[tokio::test]
    async fn setup_install_with_an_unknown_network_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let error = handle(
            &ctx,
            Request::SetupInstall {
                engine: CUDA_ENGINE.into(),
                network: "nope".into(),
                accept_licences: vec![],
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupUnknownNetwork);
    }

    #[tokio::test]
    async fn setting_the_download_source_writes_settings() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let mirror = DownloadSource::Mirror {
            url: "https://mirror.example/katago".into(),
        };
        let mut seen = ctx.source.subscribe();
        assert_eq!(
            handle(
                &ctx,
                Request::SetupSetDownloadSource {
                    source: mirror.clone()
                }
            )
            .await,
            Ok(Response::Ok)
        );
        assert_eq!(*seen.borrow_and_update(), mirror);
        assert_eq!(
            settings_json(&ctx)["downloadSource"],
            serde_json::json!({"kind": "mirror", "url": "https://mirror.example/katago"})
        );
        assert_eq!(
            load_settings(&ctx.settings_path).unwrap().download_source,
            mirror
        );
    }

    #[tokio::test]
    async fn an_invalid_download_source_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let error = handle(
            &ctx,
            Request::SetupSetDownloadSource {
                source: DownloadSource::Mirror {
                    url: "ftp://x".into(),
                },
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupInvalidSource);
        assert_eq!(*ctx.source.borrow(), DownloadSource::Direct);
        assert!(!ctx.settings_path.exists());
    }

    #[tokio::test]
    async fn accepted_licences_are_recorded_with_a_time() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let Ok(Response::SetupLicences { licences, accepted }) = handle(
            &ctx,
            Request::SetupLicences {
                engine: CUDA_ENGINE.into(),
            },
        )
        .await
        else {
            panic!("expected setupLicences");
        };
        assert!(
            licences.iter().any(|l| l.text_sha256 == CUDA_EULA),
            "{licences:?}"
        );
        assert!(accepted.is_empty());

        let response = handle(
            &ctx,
            Request::SetupInstall {
                engine: CUDA_ENGINE.into(),
                network: NETWORK.into(),
                // A hash that is not one of this engine's licences is not recorded.
                accept_licences: vec![CUDA_EULA.into(), "not-a-licence".into()],
            },
        )
        .await;
        assert_eq!(response, Ok(Response::Ok));
        // The job fails its space check without fetching anything.
        let job = ctx.installer.finished().await.expect("a job ran");
        assert!(job.outcome.is_some(), "{job:?}");

        let recorded = settings_json(&ctx)["acceptedLicences"].clone();
        let recorded = recorded.as_object().expect("an object");
        assert_eq!(recorded.keys().collect::<Vec<_>>(), [CUDA_EULA]);
        let time = recorded[CUDA_EULA].as_str().unwrap();
        assert!(
            time.len() == 20 && time.as_bytes()[10] == b'T' && time.ends_with('Z'),
            "{time}"
        );

        let Ok(Response::SetupLicences { accepted, .. }) = handle(
            &ctx,
            Request::SetupLicences {
                engine: CUDA_ENGINE.into(),
            },
        )
        .await
        else {
            panic!("expected setupLicences");
        };
        assert_eq!(accepted, [CUDA_EULA]);
    }

    /// Licences accepted in an earlier session reach the job, so it gets past its licence
    /// check (here to the space check) without the UI sending them again.
    #[tokio::test]
    async fn earlier_acceptances_carry_into_a_later_install() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let licences = ctx.installer.licences(CUDA_ENGINE).unwrap();
        assert!(!licences.is_empty());
        let earlier: serde_json::Map<_, _> = licences
            .iter()
            .map(|l| (l.text_sha256.clone(), "2026-01-01T00:00:00Z".into()))
            .collect();
        update_settings(&ctx.settings_path, |map| {
            map.insert("acceptedLicences".into(), earlier.clone().into());
        })
        .unwrap();
        let response = handle(
            &ctx,
            Request::SetupInstall {
                engine: CUDA_ENGINE.into(),
                network: NETWORK.into(),
                accept_licences: vec![],
            },
        )
        .await;
        assert_eq!(response, Ok(Response::Ok));
        let job = ctx.installer.finished().await.expect("a job ran");
        assert!(
            matches!(
                job.outcome,
                Some(JobOutcome::Failed {
                    failure: FailureCode::NotEnoughSpace,
                    ..
                })
            ),
            "{job:?}"
        );
        // Nothing new was accepted, so the earlier times stand.
        assert_eq!(
            settings_json(&ctx)["acceptedLicences"],
            serde_json::Value::from(earlier)
        );
    }

    #[tokio::test]
    async fn setup_licences_for_an_unknown_engine_is_an_error() {
        let error = handle(
            &ctx(),
            Request::SetupLicences {
                engine: "nope".into(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupUnknownEngine);
    }

    #[tokio::test]
    async fn a_cancelled_import_dialog_gives_no_network() {
        assert_eq!(
            handle(&ctx(), Request::SetupImportNetwork).await,
            Ok(Response::SetupImportNetwork { network: None })
        );
    }

    #[tokio::test]
    async fn importing_a_file_that_is_not_gzip_fails() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.txt");
        std::fs::write(&file, "not a network").unwrap();
        let ctx = ctx_in(dir.path(), Some(file));
        let error = handle(&ctx, Request::SetupImportNetwork).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupImportFailed);
    }

    #[tokio::test]
    async fn importing_a_network_records_it() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("my net.bin.gz");
        std::fs::write(&file, [0x1f, 0x8b, 8, 0]).unwrap();
        let ctx = ctx_in(dir.path(), Some(file));
        let Ok(Response::SetupImportNetwork {
            network: Some(network),
        }) = handle(&ctx, Request::SetupImportNetwork).await
        else {
            panic!("expected an imported network");
        };
        assert_eq!(network.name, "my net");
        assert!(ctx.installer.installed().networks.contains_key(&network.id));
    }

    fn installed_with_an_active_set(root: &InstallRoot) -> Installed {
        let mut installed = Installed::default();
        installed.engines.insert(
            "eng".into(),
            InstalledEngine {
                backend: Backend::Metal,
                version: "1.18.2".into(),
                binary: "katago".into(),
            },
        );
        installed.networks.insert(
            "net".into(),
            InstalledNetwork {
                file: "net.bin.gz".into(),
                name: "net".into(),
                imported: false,
            },
        );
        let set = EngineSet {
            engine: "eng".into(),
            network: "net".into(),
            runtime: None,
            config: "configs/eng/net.cfg".into(),
            threads: 8,
            benchmark: vec![],
        };
        installed.active = Some(set.key());
        installed.put_set(set);
        assert!(engine_files(root, &installed, installed.active_set().unwrap()).is_some());
        installed
    }

    #[test]
    fn startup_prefers_the_dev_engine_then_the_active_set() {
        let base = std::env::temp_dir().join("aji-startup");
        let root = InstallRoot::new(base.join("data"));
        let installed = installed_with_an_active_set(&root);
        let dev = DevEngine {
            katago: base.join("dev").join("katago"),
            model: base.join("dev").join("m.bin.gz"),
            config: base.join("dev").join("a.cfg"),
        };
        let with_dev = Settings {
            dev_engine: Some(dev.clone()),
            ..Settings::default()
        };
        assert_eq!(
            startup_files(&with_dev, &installed, &root),
            Some(dev.files())
        );
        let active = startup_files(&Settings::default(), &installed, &root).unwrap();
        assert_eq!(active.katago, root.engine_dir("eng").join("katago"));
        assert_eq!(active.working_dir, root.root());
        assert_eq!(
            startup_files(&Settings::default(), &Installed::default(), &root),
            None
        );
    }

    #[tokio::test]
    async fn setup_backends_defaults_to_metal() {
        let Ok(Response::SetupBackends { recommendation }) =
            handle(&ctx(), Request::SetupBackends).await
        else {
            panic!("expected setupBackends");
        };
        assert_eq!(recommendation.default, Some(Backend::Metal));
    }

    #[tokio::test]
    async fn setup_versions_lists_the_metal_engine() {
        let Ok(Response::SetupVersions { versions }) = handle(
            &ctx(),
            Request::SetupVersions {
                backend: Backend::Metal,
            },
        )
        .await
        else {
            panic!("expected setupVersions");
        };
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].version, "1.18.2");
    }

    async fn metal_versions(ctx: &AppContext) -> Vec<aji_manager::recommend::EngineVersionChoice> {
        let Ok(Response::SetupVersions { versions }) = handle(
            ctx,
            Request::SetupVersions {
                backend: Backend::Metal,
            },
        )
        .await
        else {
            panic!("expected setupVersions");
        };
        versions
    }

    #[tokio::test]
    async fn setup_lists_mark_what_is_already_downloaded() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        let engine = metal_versions(&ctx).await[0].engine.clone();
        let Ok(Response::SetupNetworks { networks }) = handle(
            &ctx,
            Request::SetupNetworks {
                engine: engine.clone(),
            },
        )
        .await
        else {
            panic!("expected setupNetworks");
        };
        assert!(networks.networks.len() > 1);
        assert!(networks.networks.iter().all(|n| !n.installed));
        let network = networks.networks[1].network.clone();

        let root = InstallRoot::new(dir.path().join("data"));
        let mut installed = Installed::default();
        installed.engines.insert(
            engine.clone(),
            InstalledEngine {
                backend: Backend::Metal,
                version: "1.18.2".into(),
                binary: "katago".into(),
            },
        );
        installed.networks.insert(
            network.clone(),
            InstalledNetwork {
                file: format!("{network}.bin.gz"),
                name: network.clone(),
                imported: false,
            },
        );
        save_installed(&root.record_file(), &installed).unwrap();

        assert!(metal_versions(&ctx).await[0].installed);
        let Ok(Response::SetupNetworks { networks }) =
            handle(&ctx, Request::SetupNetworks { engine }).await
        else {
            panic!("expected setupNetworks");
        };
        let marked: Vec<&str> = networks
            .networks
            .iter()
            .filter(|n| n.installed)
            .map(|n| n.network.as_str())
            .collect();
        assert_eq!(marked, [network.as_str()]);
    }

    #[tokio::test]
    async fn setup_networks_for_an_unknown_engine_is_an_error() {
        let error = handle(
            &ctx(),
            Request::SetupNetworks {
                engine: "nope".into(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::SetupUnknownEngine);
    }

    #[tokio::test]
    async fn setup_detect_returns_the_report() {
        assert_eq!(
            handle(&ctx(), Request::SetupDetect { refresh: false }).await,
            Ok(Response::SetupDetect {
                hardware: apple_m5()
            })
        );
    }

    #[tokio::test]
    async fn app_info_reports_the_context() {
        assert_eq!(
            handle(&ctx(), Request::AppInfo).await,
            Ok(Response::AppInfo(AppInfo {
                version: "0.1.0".into(),
                os: OsKind::Macos,
                arch: "aarch64".into(),
            }))
        );
    }

    #[tokio::test]
    async fn engine_status_reports_not_configured() {
        assert_eq!(
            handle(&ctx(), Request::EngineStatus).await,
            Ok(Response::EngineStatus {
                engine: EngineState::NotConfigured,
                position: aji_core::PositionKey(0x4d32_5c64_abd3_78a1),
                analysis: None,
            })
        );
    }

    #[tokio::test]
    async fn restart_without_an_engine_is_not_configured() {
        let error = handle(&ctx(), Request::EngineRestart).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::EngineNotConfigured);
    }

    #[tokio::test]
    async fn pause_without_an_engine_is_not_running() {
        let error = handle(&ctx(), Request::AnalysisPause).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::EngineNotRunning);
    }

    #[derive(Default)]
    struct Recorder(Mutex<Vec<AppEvent>>);

    impl EventSink for Recorder {
        fn emit(&self, event: AppEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[test]
    fn engine_state_events_are_forwarded() {
        let recorder = Arc::new(Recorder::default());
        let forward = forward_engine_events(recorder.clone());
        forward(EngineEvent::State(EngineState::Starting));
        assert_eq!(
            *recorder.0.lock().unwrap(),
            vec![AppEvent::EngineState {
                engine: EngineState::Starting
            }]
        );
    }

    // ------------------------------------------------------------ M5

    #[tokio::test]
    async fn settings_set_saves_applies_and_emits() {
        use crate::settings::{DiscField, LanguagePreference, ThemePreference};
        let dir = tempfile::tempdir().unwrap();
        let mut ctx = ctx_in(dir.path(), None);
        let recorded = Arc::new(Recorded::default());
        ctx.events = recorded.clone();
        let settings = UiSettings {
            language: LanguagePreference::En,
            theme: ThemePreference::Light,
            disc_lines: [DiscField::ScoreLead, DiscField::Visits],
            visit_limit: Some(800),
        };
        assert_eq!(
            handle(
                &ctx,
                Request::SettingsSet {
                    settings: settings.clone()
                }
            )
            .await,
            Ok(Response::Settings {
                settings: settings.clone()
            })
        );
        assert_eq!(load_settings(&ctx.settings_path).unwrap().ui, settings);
        assert_eq!(
            handle(&ctx, Request::SettingsGet).await,
            Ok(Response::Settings {
                settings: settings.clone()
            })
        );
        assert_eq!(
            *recorded.0.lock().unwrap(),
            [AppEvent::SettingsChanged { settings }]
        );
    }

    #[tokio::test]
    async fn settings_get_without_a_file_gives_the_defaults() {
        assert_eq!(
            handle(&ctx(), Request::SettingsGet).await,
            Ok(Response::Settings {
                settings: UiSettings::default()
            })
        );
    }

    #[tokio::test]
    async fn restart_is_refused_while_the_installer_holds_the_engine() {
        let ctx = ctx();
        ctx.installer.set_holds_engine(true);
        for request in [Request::EngineRestart, Request::AnalysisResume] {
            assert_eq!(
                handle(&ctx, request).await.unwrap_err().code,
                ErrorCode::EngineBusy
            );
        }
        ctx.installer.set_holds_engine(false);
        assert_eq!(
            handle(&ctx, Request::EngineRestart).await.unwrap_err().code,
            ErrorCode::EngineNotConfigured
        );
    }

    #[tokio::test]
    async fn detect_with_refresh_redetects() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let mut ctx = ctx();
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);
        ctx.setup = Arc::new(Setup::with_detector(
            aji_manager::manifest::ManifestStore::fixed(
                aji_manager::manifest::parse_manifest(aji_manager::manifest::BUNDLED).unwrap(),
            ),
            Arc::new(move || {
                counted.fetch_add(1, Ordering::SeqCst);
                apple_m5()
            }),
        ));
        handle(&ctx, Request::SetupDetect { refresh: false })
            .await
            .unwrap();
        handle(&ctx, Request::SetupDetect { refresh: false })
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        handle(&ctx, Request::SetupDetect { refresh: true })
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn installed_reports_no_active_set_on_an_empty_root() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_in(dir.path(), None);
        assert_eq!(
            handle(&ctx, Request::SetupInstalled).await,
            Ok(Response::SetupInstalled {
                active: None,
                unused_bytes: 0
            })
        );
        assert_eq!(
            handle(&ctx, Request::SetupRemoveUnused).await,
            Ok(Response::SetupRemoved { freed_bytes: 0 })
        );
    }
}
