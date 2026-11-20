//! Drives the `rpc` command through Tauri's mock runtime, so the JSON contract the UI relies on
//! is tested without a real webview.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use aji_core::{BoardSize, Komi, Position, Rules};
use aji_engine::{Engine, EngineOptions, EngineState};
use aji_lib::{
    EVENT_CHANNEL, TauriEventSink, configure,
    protocol::{AppEvent, OsKind},
    service::{AppContext, EventSink, FilePicker},
};
use aji_manager::Setup;
use aji_manager::hardware::{CpuReport, HardwareReport, OsReport};
use aji_manager::install::{
    DownloadSource, FreeSpace, InstallOptions, InstallRoot, Installer, InstallerParts, JobSnapshot,
};
use aji_manager::manifest::{BUNDLED, ClientOptions, ManifestStore, Platform, http_client};
use serde_json::{Value, json};
use tauri::Listener;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;

fn unconfigured_engine() -> Engine {
    let position = Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap());
    tauri::async_runtime::block_on(async {
        Engine::spawn(None, position, EngineOptions::default(), |_| {})
    })
}

fn linux_report() -> HardwareReport {
    HardwareReport {
        os: OsReport {
            kind: OsKind::Linux,
            version: String::new(),
            arch: "x86_64".into(),
        },
        cpu: CpuReport {
            name: "cpu".into(),
            cores: 4,
            threads: 8,
            avx2: true,
        },
        memory_bytes: 16 << 30,
        gpus: Vec::new(),
        problems: Vec::new(),
    }
}

/// No free space anywhere, so no job these tests start ever fetches anything.
struct NoSpace;

impl FreeSpace for NoSpace {
    fn available(&self, _: &Path) -> std::io::Result<u64> {
        Ok(0)
    }
}

/// A file dialog the user always cancels.
struct Cancelled;

impl FilePicker for Cancelled {
    fn pick_network(&self) -> Option<PathBuf> {
        None
    }
}

/// A context whose folders do not exist; no request in these tests writes to them.
fn context() -> AppContext {
    let engine = unconfigured_engine();
    let setup = Arc::new(Setup::with_hardware(
        ManifestStore::open(BUNDLED, "no-such-manifest-cache".into(), Vec::new()),
        linux_report(),
    ));
    let source = tokio::sync::watch::Sender::new(DownloadSource::Direct);
    let parts = InstallerParts {
        root: InstallRoot::new("no-such-aji-folder".into()),
        setup: Arc::clone(&setup),
        engine: engine.clone(),
        client: http_client("Aji/test", ClientOptions::default()).unwrap(),
        source: source.subscribe(),
        space: Arc::new(NoSpace),
        options: InstallOptions::default(),
        // The tests name the bundled manifest's Linux engines.
        platform: Some(Platform::LinuxX64),
    };
    // Jobs run on the runtime current when the installer is made: Tauri's.
    let installer =
        tauri::async_runtime::block_on(async { Installer::new(parts, |_: JobSnapshot| {}) });
    AppContext {
        version: "0.1.0".into(),
        os: OsKind::Linux,
        arch: "x86_64".into(),
        engine,
        setup,
        installer,
        settings_path: PathBuf::from("no-such-aji-folder").join("settings.json"),
        files: Arc::new(Cancelled),
        source,
        events: Arc::new(Discard),
        game: Arc::new(tokio::sync::Mutex::new(
            aji_lib::game::GameSession::new(19, Default::default()).unwrap(),
        )),
    }
}

/// Drops events a request causes; these tests check replies only.
struct Discard;

impl aji_lib::service::EventSink for Discard {
    fn emit(&self, _: aji_lib::protocol::AppEvent) {}
}

fn invoke_rpc(body: Value) -> Result<Value, Value> {
    let ctx = context();
    let app = configure(mock_builder())
        .manage(ctx)
        .build(mock_context(noop_assets()))
        .expect("mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");
    let url = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: "rpc".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|response| response.deserialize::<Value>().expect("JSON response"))
}

#[test]
fn rpc_answers_app_info() {
    assert_eq!(
        invoke_rpc(json!({"request": {"type": "appInfo"}})),
        Ok(json!({"type": "appInfo", "version": "0.1.0", "os": "linux", "arch": "x86_64"}))
    );
}

#[test]
fn rpc_answers_setup_backends() {
    let response = invoke_rpc(json!({"request": {"type": "setupBackends"}})).unwrap();
    assert_eq!(response["type"], "setupBackends");
}

#[test]
fn malformed_request_is_rejected_with_a_plain_string() {
    // Tauri rejects arguments it cannot deserialise before our handler runs. The UI must
    // normalise this string into an internal error (Review Focus 4).
    let error = invoke_rpc(json!({"request": {"type": "nope"}})).expect_err("must be rejected");
    assert!(error.is_string(), "expected a string error, got {error}");
}

#[test]
fn rpc_opens_a_game_from_base64() {
    // "(;SZ[9];B[ee])" in base64.
    let response = invoke_rpc(json!({"request": {"type": "gameOpen", "name": "a.sgf",
        "bytes": "KDtTWls5XTtCW2VlXSk="}}))
    .unwrap();
    assert_eq!(response["type"], "game");
    assert_eq!(response["snapshot"]["size"], 9);
    assert_eq!(response["snapshot"]["mainLineLength"], 1);
    assert_eq!(
        response["snapshot"]["rules"]["current"],
        json!({"kind": "chinese"})
    );
    assert_eq!(response["warnings"], json!([]));
    let error = invoke_rpc(json!({"request": {"type": "gameNew", "size": 21}})).unwrap_err();
    assert_eq!(
        error,
        json!({"code": "sgfUnsupportedSize", "message": "21x21", "detail": "21x21"})
    );
}

#[test]
fn rpc_answers_engine_status() {
    assert_eq!(
        invoke_rpc(json!({"request": {"type": "engineStatus"}})),
        Ok(
            json!({"type": "engineStatus", "engine": {"state": "notConfigured"},
               "position": "4d325c64abd378a1", "analysis": null})
        )
    );
}

#[test]
fn engine_events_reach_the_webview_channel() {
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app");
    let received = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&received);
    app.listen(EVENT_CHANNEL, move |event| {
        sink.lock().unwrap().push(event.payload().to_string());
    });
    TauriEventSink(app.handle().clone()).emit(AppEvent::EngineState {
        engine: EngineState::Stopped,
    });
    let payloads = received.lock().unwrap();
    assert_eq!(payloads.len(), 1);
    let payload: Value = serde_json::from_str(&payloads[0]).unwrap();
    assert_eq!(
        payload,
        json!({"type": "engineState", "engine": {"state": "stopped"}})
    );
}

#[test]
fn rpc_answers_setup_status() {
    assert_eq!(
        invoke_rpc(json!({"request": {"type": "setupStatus"}})),
        Ok(json!({"type": "setupStatus", "job": null}))
    );
}

#[test]
fn rpc_rejects_an_unknown_network_with_its_code() {
    let error = invoke_rpc(json!({"request": {"type": "setupInstall",
        "engine": "katago-v1.18.1-eigenavx2-linux-x64", "network": "nope", "acceptLicences": []}}))
    .expect_err("an unknown network");
    assert_eq!(error["code"], "setupUnknownNetwork");
}

#[test]
fn setup_progress_events_reach_the_webview_channel() {
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app");
    let received = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&received);
    app.listen(EVENT_CHANNEL, move |event| {
        sink.lock().unwrap().push(event.payload().to_string());
    });
    let job = JobSnapshot {
        id: 3,
        engine: "e".into(),
        backend: aji_manager::manifest::Backend::Eigen,
        network: "n".into(),
        tasks: vec![],
        outcome: None,
        measures: false,
        benchmark: None,
    };
    TauriEventSink(app.handle().clone()).emit(AppEvent::SetupProgress { job });
    let payloads = received.lock().unwrap();
    let payload: Value = serde_json::from_str(&payloads[0]).unwrap();
    assert_eq!(payload["type"], "setupProgress");
    assert_eq!(payload["job"]["id"], 3);
}
