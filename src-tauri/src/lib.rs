mod ipc;
pub mod protocol;
pub mod service;
pub mod settings;
pub mod window;

use std::sync::Arc;
use std::time::Duration;

use aji_core::{BoardSize, Komi, Position, Rules};
use aji_engine::{Engine, EngineOptions};
use tauri::{Manager, RunEvent};

pub use ipc::{EVENT_CHANNEL, TauriEventSink};
use service::AppContext;

/// How long exit waits for KataGo to stop before giving up on it.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

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

fn start_engine(app: &tauri::App) -> Engine {
    let files = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .and_then(|dir| {
            settings::load_settings(&dir.join("settings.json")).map_err(|e| e.to_string())
        })
        .unwrap_or_else(|error| {
            eprintln!("aji: starting without an engine: {error}");
            settings::Settings::default()
        })
        .dev_engine
        .map(|dev| dev.files());
    let sink = Arc::new(TauriEventSink(app.handle().clone()));
    tauri::async_runtime::block_on(async {
        Engine::spawn(
            files,
            default_position(),
            EngineOptions::default(),
            service::forward_engine_events(sink),
        )
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let version = context.package_info().version.to_string();
    let app = configure(tauri::Builder::default())
        .setup(move |app| {
            fit_main_window(app);
            let engine = start_engine(app);
            app.manage(AppContext::detect(version, engine));
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application");
    app.run(|app, event| {
        if let RunEvent::Exit = event
            && let Some(ctx) = app.try_state::<AppContext>()
        {
            let engine = ctx.engine.clone();
            // An unkillable KataGo must not keep the app from exiting.
            let _ = tauri::async_runtime::block_on(tokio::time::timeout(
                SHUTDOWN_TIMEOUT,
                engine.shutdown(),
            ));
        }
    });
}
