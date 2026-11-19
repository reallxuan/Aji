//! `aji-manifest generate ...` builds the install manifest; `aji-manifest verify ...` checks a
//! signed copy.

use std::path::PathBuf;
use std::process::ExitCode;

use aji_manager::manifest::{parse_manifest, verify};
use aji_manifest_tool::generate::{generate, parse_args};
use minisign_verify::PublicKey;

const USAGE: &str = "usage:
  aji-manifest generate --out <manifest.json> [--sequence <n>] [--katago-releases <file>]
      [--metal-releases <file>] [--networks-page <file>] [--network-heads <file>]
      [--nvidia-dir <dir>] [--licence-texts <file>]
  aji-manifest verify --manifest <file> --signature <file> --public-key <file>";

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("generate") => run_generate(&args[1..]).await,
        Some("verify") => run_verify(&args[1..]),
        _ => Err(USAGE.to_owned()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

async fn run_generate(args: &[String]) -> Result<(), String> {
    let options = parse_args(args).map_err(|e| format!("{e}\n{USAGE}"))?;
    let out = options
        .out
        .clone()
        .ok_or_else(|| format!("--out is required\n{USAGE}"))?;
    let bytes = generate(&options).await?;
    aji_manifest_tool::write_output(&out, &bytes)?;
    let m = parse_manifest(&bytes).map_err(|e| e.to_string())?;
    println!(
        "wrote {}: sequence {} engines {} runtimes {} networks {}",
        out.display(),
        m.sequence,
        m.engines.len(),
        m.runtimes.len(),
        m.networks.len()
    );
    Ok(())
}

fn run_verify(args: &[String]) -> Result<(), String> {
    let (mut manifest, mut signature, mut key) = (None, None, None);
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let slot = match flag.as_str() {
            "--manifest" => &mut manifest,
            "--signature" => &mut signature,
            "--public-key" => &mut key,
            other => return Err(format!("unknown flag {other}\n{USAGE}")),
        };
        *slot = Some(PathBuf::from(
            it.next().ok_or_else(|| format!("{flag} needs a value"))?,
        ));
    }
    let need =
        |p: Option<PathBuf>, flag: &str| p.ok_or_else(|| format!("{flag} is required\n{USAGE}"));
    let (manifest, signature, key) = (
        need(manifest, "--manifest")?,
        need(signature, "--signature")?,
        need(key, "--public-key")?,
    );
    let bytes = std::fs::read(&manifest).map_err(|e| format!("{}: {e}", manifest.display()))?;
    let signature =
        std::fs::read_to_string(&signature).map_err(|e| format!("{}: {e}", signature.display()))?;
    let key = PublicKey::from_file(&key).map_err(|e| format!("{}: {e}", key.display()))?;
    verify(&bytes, &signature, &[key]).map_err(|e| format!("verification failed: {e:?}"))?;
    let m = parse_manifest(&bytes).map_err(|e| e.to_string())?;
    println!(
        "sequence {} engines {} runtimes {} networks {}",
        m.sequence,
        m.engines.len(),
        m.runtimes.len(),
        m.networks.len()
    );
    Ok(())
}
