//! Prints what the setup wizard would offer on a machine: the manifest in use, the hardware, the
//! recommended backend, the engine versions for every listed backend and the networks of the
//! default backend's newest engine.
//!
//! `aji-setup-report [--fetch] [--hardware <report.json> | --windows-capture <capture.json>]`
//!
//! The manifest store opens on a fresh temporary folder, so nothing is cached between runs.

use std::process::ExitCode;

use aji_manager::Setup;
use aji_manager::hardware::{HardwareReport, report_from_windows_capture};
use aji_manager::manifest::{
    BUNDLED, ClientOptions, MANIFEST_BASES, ManifestStore, http_client, trusted_keys,
};
use serde_json::{Map, Value, json};

const USAGE: &str = "usage: aji-setup-report [--fetch] [--hardware <report.json> | --windows-capture <capture.json>]";

struct Args {
    fetch: bool,
    hardware: Option<HardwareReport>,
}

fn parse_args() -> Result<Args, String> {
    let mut args = std::env::args().skip(1);
    let mut fetch = false;
    let mut hardware = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--fetch" => fetch = true,
            "--hardware" | "--windows-capture" => {
                if hardware.is_some() {
                    return Err("give only one of --hardware and --windows-capture".into());
                }
                let path = args.next().ok_or_else(|| format!("{arg} needs a file"))?;
                let text = std::fs::read_to_string(&path)
                    .map_err(|e| format!("cannot read {path}: {e}"))?;
                hardware = Some(if arg == "--hardware" {
                    serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?
                } else {
                    report_from_windows_capture(&text).map_err(|e| format!("{path}: {e}"))?
                });
            }
            _ => return Err(format!("unknown argument {arg}")),
        }
    }
    Ok(Args { fetch, hardware })
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let cache = match tempfile_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("cannot make a temporary folder: {e}");
            return ExitCode::FAILURE;
        }
    };
    let store = ManifestStore::open(BUNDLED, cache.clone(), trusted_keys());
    if args.fetch {
        let agent = format!("Aji/{}", env!("CARGO_PKG_VERSION"));
        let refreshed = match http_client(&agent, ClientOptions::default()) {
            Ok(client) => store.refresh(&client, MANIFEST_BASES).await,
            Err(e) => Err(e),
        };
        // The report still shows the copy in use, so a failed fetch is logged, not fatal.
        if let Err(e) = refreshed {
            eprintln!("aji: manifest fetch failed: {e}");
        }
    }
    let setup = match args.hardware {
        Some(report) => Setup::with_hardware(store, report),
        None => Setup::new(store),
    };

    let hardware = setup.hardware().await;
    let recommendation = setup.backends().await;
    let mut versions = Map::new();
    let mut newest_default = None;
    for choice in &recommendation.backends {
        let list = setup.versions(choice.backend).await;
        if Some(choice.backend) == recommendation.default {
            newest_default = list.first().map(|v| v.engine.clone());
        }
        let key = serde_json::to_value(choice.backend).unwrap_or(Value::Null);
        versions.insert(
            key.as_str().unwrap_or("unknown").to_string(),
            serde_json::to_value(list).unwrap_or(Value::Null),
        );
    }
    let mut networks = Map::new();
    if let Some(engine) = newest_default
        && let Some(list) = setup.networks(&engine).await
    {
        networks.insert(engine, serde_json::to_value(list).unwrap_or(Value::Null));
    }
    let current = setup.manifest().current();
    let rejected: Vec<String> = current
        .rejected
        .iter()
        .map(|(source, rejection)| format!("{source:?}: {rejection:?}"))
        .collect();
    let report = json!({
        "manifest": {
            "source": current.source,
            "sequence": current.manifest.sequence,
            "rejected": rejected,
        },
        "hardware": hardware,
        "recommendation": recommendation,
        "versions": versions,
        "networks": networks,
    });
    match serde_json::to_string_pretty(&report) {
        Ok(text) => println!("{text}"),
        Err(e) => {
            eprintln!("cannot print the report: {e}");
            return ExitCode::FAILURE;
        }
    }
    let _ = std::fs::remove_dir_all(&cache);
    ExitCode::SUCCESS
}

/// A folder that no earlier run has used. A refresh may cache into it; it is removed at the end.
fn tempfile_dir() -> std::io::Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join(format!("aji-setup-report-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
