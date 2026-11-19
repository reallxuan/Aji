//! Pins installer settings whose defaults would hurt users.

use serde_json::{Value, json};

fn config() -> Value {
    serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json is JSON")
}

#[test]
fn macos_app_is_ad_hoc_signed() {
    // Apple Silicon reports an unsigned app downloaded from the internet as "damaged",
    // with no "Open Anyway" path. An ad-hoc signature avoids that without a paid certificate.
    assert_eq!(config()["bundle"]["macOS"]["signingIdentity"], "-");
}

#[test]
fn nsis_falls_back_to_english() {
    // NSIS uses the first listed language when the system language is not in the list,
    // so a Japanese or Korean Windows must not get the Chinese installer.
    assert_eq!(
        config()["bundle"]["windows"]["nsis"]["languages"],
        json!(["English", "SimpChinese"])
    );
}

#[test]
fn publisher_is_explicit() {
    // Without it Tauri derives "github" from the identifier. It is shown in Windows
    // "Installed apps" and names the registry key, so it is costly to change later.
    assert_eq!(config()["bundle"]["publisher"], "reallxuan");
}
