//! The UI only invokes the app's own `rpc` command and listens to events, so the main window gets
//! nothing else.

use serde_json::{Value, json};

#[test]
fn main_window_may_only_use_events() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("capability file is JSON");
    assert_eq!(capability["windows"], json!(["main"]));
    assert_eq!(capability["permissions"], json!(["core:event:default"]));
}
