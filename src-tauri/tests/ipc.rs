//! Drives the `rpc` command through Tauri's mock runtime, so the JSON contract the UI relies on
//! is tested without a real webview.

use aji_lib::{configure, protocol::OsKind, service::AppContext};
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;

fn invoke_rpc(body: Value) -> Result<Value, Value> {
    let ctx = AppContext {
        version: "0.1.0".into(),
        os: OsKind::Linux,
        arch: "x86_64".into(),
    };
    let app = configure(mock_builder(), ctx)
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
fn malformed_request_is_rejected_with_a_plain_string() {
    // Tauri rejects arguments it cannot deserialise before our handler runs. The UI must
    // normalise this string into an internal error (Review Focus 4).
    let error = invoke_rpc(json!({"request": {"type": "nope"}})).expect_err("must be rejected");
    assert!(error.is_string(), "expected a string error, got {error}");
}
