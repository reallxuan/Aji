//! Zips the install-job tests serve: an engine package around the fake KataGo, and any other.

use std::io::{Cursor, Write};

use serde_json::Value;
use zip::write::SimpleFileOptions;

use super::fake::{EXE, transcript};

/// A deflate zip holding the fake KataGo as `katago` (or `katago.exe`), `scenario` as
/// `fake-katago-scenario.json`, and the M2 transcript as `analysis.jsonl`, which the scenario
/// points at unless it names another.
pub fn engine_zip(mut scenario: Value) -> Vec<u8> {
    if scenario.get("transcript").is_none() {
        scenario["transcript"] = "analysis.jsonl".into();
    }
    let fake = std::fs::read(env!("CARGO_BIN_EXE_aji-manager-fake-katago")).unwrap();
    let transcript = std::fs::read(transcript()).unwrap();
    let scenario = serde_json::to_vec(&scenario).unwrap();
    zip_of(&[
        (EXE, &fake),
        ("fake-katago-scenario.json", &scenario),
        ("analysis.jsonl", &transcript),
    ])
}

/// A deflate zip holding `entries`.
pub fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(1));
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}
