mod dev_install;
mod ipc;
pub mod protocol;
pub mod service;
pub mod settings;
#[cfg(test)]
mod test_support;
pub mod window;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aji_core::{BoardSize, Komi, Position, Rules};
use aji_engine::{Engine, EngineFiles, EngineOptions};
use aji_manager::Setup;
use aji_manager::install::{
    DownloadSource, InstallOptions, InstallRoot, Installed, Installer, InstallerParts, JobSnapshot,
    SystemFreeSpace, load_installed,
};
use aji_manager::manifest::{
    BUNDLED, ClientOptions, MANIFEST_BASES, ManifestStore, http_client, trusted_keys,
};
use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::watch;

pub use ipc::{EVENT_CHANNEL, TauriEventSink};
use protocol::{AppEvent, OsKind};
use service::{AppContext, EventSink, FilePicker};
use settings::Settings;

/// How long exit waits for an install job and KataGo to stop before giving up on them.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

/// The download client's limit for opening a connection. It sets no limit on a whole request:
/// the downloader catches stalls itself, and any fixed limit would cut a large download.
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Registers the `rpc` command. Generic over the runtime so tests can use Tauri's mock runtime;
/// they `.manage` their own [`AppContext`].
pub fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![ipc::rpc])
}

/// An empty 19x19 board, Chinese rules, komi 7.5.
fn default_position() -> Position {
    Position::empty(
        BoardSize::NINETEEN,
        Rules::Chinese,
        Komi::new(7.5).expect("7.5 is a valid komi"),
    )
}

fn fit_main_window(app: &tauri::App) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(monitor)) = main.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area().size;
    let work = (
        f64::from(area.width) / scale,
        f64::from(area.height) / scale,
    );
    let (width, height) = window::fit_window((1440.0, 900.0), (1024.0, 640.0), work);
    let Ok(current) = main.inner_size().map(|s| s.to_logical::<f64>(scale)) else {
        return;
    };
    if (current.width, current.height) != (width, height) {
        let _ = main.set_size(tauri::LogicalSize::new(width, height));
        let _ = main.center();
    }
}

/// `settings.json` in the app config folder. Without one, a folder of this run's own in the
/// temp directory: nothing is kept between runs, and no other folder is touched.
fn settings_path(app: &tauri::App) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap_or_else(|error| {
        eprintln!("aji: settings are not kept between runs: {error}");
        std::env::temp_dir().join(format!("aji-config-{}", std::process::id()))
    });
    dir.join("settings.json")
}

/// The install root and manifest cache folder, with the same fallback as [`settings_path`].
fn local_data_dir(app: &tauri::App) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|error| {
        eprintln!("aji: installs and the manifest cache are not kept between runs: {error}");
        std::env::temp_dir().join(format!("aji-data-{}", std::process::id()))
    })
}

/// The settings, or the defaults when they cannot be read.
fn load_settings(path: &Path) -> Settings {
    settings::load_settings(path).unwrap_or_else(|error| {
        eprintln!("aji: using the default settings: {error}");
        Settings::default()
    })
}

/// The stored download source, or `Direct` when it is not a valid one.
fn download_source(settings: &Settings) -> DownloadSource {
    match settings.download_source.validate() {
        Ok(()) => settings.download_source.clone(),
        Err(error) => {
            eprintln!("aji: downloading directly: {error}");
            DownloadSource::Direct
        }
    }
}

/// Which engine starts: logged, since it decides what the user sees first.
fn engine_files(
    settings: &Settings,
    installed: &Installed,
    root: &InstallRoot,
) -> Option<EngineFiles> {
    let files = service::startup_files(settings, installed, root);
    match (&settings.dev_engine, &installed.active, &files) {
        (Some(_), _, _) => eprintln!("aji: starting the development engine"),
        (None, Some(active), Some(_)) => eprintln!(
            "aji: starting the installed engine {} with {}",
            active.engine, active.network
        ),
        (None, Some(active), None) => eprintln!(
            "aji: starting without an engine: the active set {} with {} is incomplete",
            active.engine, active.network
        ),
        (None, None, _) => eprintln!("aji: starting without an engine: none is installed"),
    }
    files
}

fn start_engine(files: Option<EngineFiles>, sink: Arc<dyn EventSink>) -> Engine {
    tauri::async_runtime::block_on(async {
        Engine::spawn(
            files,
            default_position(),
            EngineOptions::default(),
            service::forward_engine_events(sink),
        )
    })
}

/// The installer, with a download client of its own: the manifest client's whole-request limit
/// would cut every large download. Its progress goes out as `setupProgress` events, and with
/// the development trigger set it is logged too.
fn start_installer(
    version: &str,
    root: InstallRoot,
    setup: Arc<Setup>,
    engine: Engine,
    source: watch::Receiver<DownloadSource>,
    sink: Arc<dyn EventSink>,
) -> Result<Arc<Installer>, String> {
    let options = ClientOptions {
        timeout: None,
        connect_timeout: DOWNLOAD_CONNECT_TIMEOUT,
    };
    let client = http_client(&format!("Aji/{version}"), options).map_err(|e| e.to_string())?;
    let parts = InstallerParts {
        root,
        setup,
        engine,
        client,
        source,
        space: Arc::new(SystemFreeSpace),
        options: InstallOptions::default(),
    };
    let logged = dev_install::dev_install_value().map(|_| Mutex::new(None::<JobSnapshot>));
    let on_progress = move |job: JobSnapshot| {
        if let Some(logged) = &logged {
            let mut last = logged.lock().unwrap_or_else(|e| e.into_inner());
            let before = last.as_ref().filter(|before| before.id == job.id);
            for line in dev_install::progress_lines(before, &job) {
                eprintln!("{line}");
            }
            *last = Some(job.clone());
        }
        sink.emit(AppEvent::SetupProgress { job });
    };
    // Jobs run on the runtime current when the installer is made: Tauri's.
    Ok(tauri::async_runtime::block_on(async {
        Installer::new(parts, on_progress)
    }))
}

/// The native file dialog, for importing a network.
struct DialogPicker(tauri::AppHandle);

impl FilePicker for DialogPicker {
    fn pick_network(&self) -> Option<PathBuf> {
        // "KataGo" names the filter: a product name, the same in every language.
        let mut dialog = self.0.dialog().file().add_filter("KataGo", &["gz"]);
        if let Some(main) = self.0.get_webview_window("main") {
            dialog = dialog.set_parent(&main);
        }
        match dialog.blocking_pick_file()?.into_path() {
            Ok(path) => Some(path),
            Err(error) => {
                eprintln!("aji: the chosen network is not a file path: {error}");
                None
            }
        }
    }
}

/// Opens the manifest store and refreshes it in the background. The refresh is never awaited: the
/// bundled or cached copy answers setup requests until a newer one arrives.
fn start_setup(version: &str, cache_dir: PathBuf) -> Arc<Setup> {
    let setup = Arc::new(Setup::new(ManifestStore::open(
        BUNDLED,
        cache_dir,
        trusted_keys(),
    )));
    let refreshing = Arc::clone(&setup);
    let client = http_client(&format!("Aji/{version}"), ClientOptions::default());
    tauri::async_runtime::spawn(async move {
        let refreshed = match client {
            Ok(client) => refreshing.manifest().refresh(&client, MANIFEST_BASES).await,
            Err(e) => Err(e),
        };
        // A failed fetch leaves the bundled or cached copy in use.
        if let Err(e) = refreshed {
            eprintln!("aji: manifest fetch failed: {e}");
        }
        let current = refreshing.manifest().current();
        eprintln!(
            "aji: manifest {:?} sequence {}",
            current.source, current.manifest.sequence
        );
        for (source, rejection) in &current.rejected {
            eprintln!("aji: manifest {source:?} rejected: {rejection:?}");
        }
    });
    setup
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let version = context.package_info().version.to_string();
    let app = configure(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            fit_main_window(app);
            let sink: Arc<dyn EventSink> = Arc::new(TauriEventSink(app.handle().clone()));
            let settings_path = settings_path(app);
            let settings = load_settings(&settings_path);
            let data_dir = local_data_dir(app);
            let root = InstallRoot::new(data_dir.clone());
            let installed = load_installed(&root.record_file());
            let files = engine_files(&settings, &installed, &root);
            let engine = start_engine(files, Arc::clone(&sink));
            let setup = start_setup(&version, data_dir.join("manifest"));
            let source = watch::Sender::new(download_source(&settings));
            let installer = start_installer(
                &version,
                root,
                Arc::clone(&setup),
                engine.clone(),
                source.subscribe(),
                sink,
            )?;
            if let Some(value) = dev_install::dev_install_value() {
                let configured = settings.dev_engine.is_some() || installed.active.is_some();
                dev_install::start(
                    value,
                    configured,
                    Arc::clone(&setup),
                    Arc::clone(&installer),
                );
            }
            app.manage(AppContext {
                version,
                os: OsKind::current(),
                arch: std::env::consts::ARCH.to_string(),
                engine,
                setup,
                installer,
                settings_path,
                files: Arc::new(DialogPicker(app.handle().clone())),
                source,
            });
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application");
    app.run(|app, event| {
        if let RunEvent::Exit = event
            && let Some(ctx) = app.try_state::<AppContext>()
        {
            let (installer, engine) = (Arc::clone(&ctx.installer), ctx.engine.clone());
            // A cancelled job may restart the engine it stopped, so the engine stops last. An
            // unkillable KataGo must not keep the app from exiting.
            installer.cancel();
            let _ = tauri::async_runtime::block_on(tokio::time::timeout(
                SHUTDOWN_TIMEOUT,
                async move {
                    installer.finished().await;
                    engine.shutdown().await
                },
            ));
        }
    });
}
