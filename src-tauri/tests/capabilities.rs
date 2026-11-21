//! The UI only invokes the app's own commands, listens to events (drops arrive as events), sets
//! the window title to the game's, keeps the window on top when asked (P2 M1 design 5.9), and
//! opens `https` links in the system browser (licences, the driver page, the source link), so
//! the main window gets nothing else.

use serde_json::{Value, json};

#[test]
fn main_window_may_only_use_events_set_its_title_and_on_top_and_open_https_links() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("capability file is JSON");
    assert_eq!(capability["windows"], json!(["main"]));
    assert_eq!(
        capability["permissions"],
        json!([
            "core:event:default",
            "core:window:allow-set-title",
            "core:window:allow-set-always-on-top",
            {"identifier": "opener:allow-open-url", "allow": [{"url": "https://*"}]}
        ])
    );
}
