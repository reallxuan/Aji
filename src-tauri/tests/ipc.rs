//! Drives the `rpc` command through Tauri's mock runtime, so the JSON contract the UI relies on
//! is tested without a real webview.

use std::sync::{Arc, Mutex};

use aji_core::{BoardSize, Komi, Position, Rules};
use aji_engine::{Engine, EngineOptions, EngineState};
use aji_lib::{
    EVENT_CHANNEL, TauriEventSink, configure,
    protocol::{AppEvent, OsKind},
    service::{AppContext, EventSink},
};
use aji_manager::Setup;
use aji_manager::hardware::{CpuReport, HardwareReport, OsReport};
use aji_manager::manifest::{BUNDLED, ManifestStore};
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

fn invoke_rpc(body: Value) -> Result<Value, Value> {
    let ctx = AppContext {
        version: "0.1.0".into(),
        os: OsKind::Linux,
        arch: "x86_64".into(),
        engine: unconfigured_engine(),
        setup: Arc::new(Setup::with_hardware(
            ManifestStore::open(BUNDLED, "no-such-manifest-cache".into(), Vec::new()),
            linux_report(),
        )),
    };
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
