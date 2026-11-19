//! Builds the manifest from its sources, which are files (tests, offline runs) or the live
//! services. Nothing here downloads an engine, network or runtime archive.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use aji_manager::manifest::{ClientOptions, Engine, Manifest, SCHEMA, http_client, parse_manifest};
use serde_json::{Map, Value};

use crate::networks::{self, Head};
use crate::nvidia::{self, Redist};
use crate::releases::{self, Source};

const KATAGO_RELEASES: &str =
    "https://api.github.com/repos/lightvector/KataGo/releases?per_page=30";
const METAL_RELEASES: &str =
    "https://api.github.com/repos/reallxuan/aji-manifest/releases?per_page=30";
const NETWORKS_PAGE: &str = "https://katagotraining.org/networks/";

/// The `generate` options. A source left `None` is read live.
#[derive(Debug, Default, Clone)]
pub struct Options {
    pub out: Option<PathBuf>,
    pub sequence: Option<u64>,
    pub katago_releases: Option<PathBuf>,
    pub metal_releases: Option<PathBuf>,
    pub networks_page: Option<PathBuf>,
    pub network_heads: Option<PathBuf>,
    /// A folder holding the NVIDIA redist JSON files by name, such as `redistrib_13.2.2.json`.
    pub nvidia_dir: Option<PathBuf>,
    /// One file whose text stands in for every component's licence text.
    pub licence_texts: Option<PathBuf>,
}

/// Reads the live services, or tells why that failed.
struct Live {
    client: reqwest::Client,
    token: Option<String>,
}

impl Live {
    fn new() -> Live {
        let agent = concat!("aji-manifest/", env!("CARGO_PKG_VERSION"));
        Live {
            client: http_client(
                agent,
                ClientOptions {
                    timeout: Duration::from_secs(60),
                },
            ),
            token: std::env::var("GH_TOKEN").ok().filter(|t| !t.is_empty()),
        }
    }

    async fn text(&self, url: &str) -> Result<String, String> {
        let mut request = self.client.get(url);
        if url.starts_with("https://api.github.com/") {
            request = request.header("Accept", "application/vnd.github+json");
            if let Some(t) = &self.token {
                request = request.bearer_auth(t);
            }
        }
        let response = request.send().await.map_err(|e| format!("{url}: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("{url}: the server answered {status}"));
        }
        response.text().await.map_err(|e| format!("{url}: {e}"))
    }

    /// The body exactly as served, for hashing.
    async fn bytes(&self, url: &str) -> Result<Vec<u8>, String> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("{url}: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("{url}: the server answered {}", response.status()));
        }
        let body = response.bytes().await.map_err(|e| format!("{url}: {e}"))?;
        Ok(body.to_vec())
    }

    async fn head(&self, url: &str) -> Result<Head, String> {
        let response = self
            .client
            .head(url)
            .send()
            .await
            .map_err(|e| format!("{url}: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("{url}: the server answered {}", response.status()));
        }
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
                .ok_or_else(|| format!("{url}: the answer has no {name}"))
        };
        Ok(Head {
            url: url.to_owned(),
            content_length: header("content-length")?
                .parse()
                .map_err(|_| format!("{url}: bad content-length"))?,
            etag: header("etag")?,
            last_modified: header("last-modified")?,
        })
    }
}

fn read(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Builds the manifest and returns its bytes: pretty JSON with sorted keys.
pub async fn generate(options: &Options) -> Result<Vec<u8>, String> {
    let live = Live::new();

    let katago = match &options.katago_releases {
        Some(p) => read(p)?,
        None => live.text(KATAGO_RELEASES).await?,
    };
    let metal = match &options.metal_releases {
        Some(p) => read(p)?,
        None => live.text(METAL_RELEASES).await?,
    };
    let mut engines: Vec<Engine> = releases::engines(&katago, Source::KataGo)?;
    engines.extend(releases::engines(&metal, Source::Metal)?);
    let engines = sort_engines(engines);

    let page = match &options.networks_page {
        Some(p) => read(p)?,
        None => live.text(NETWORKS_PAGE).await?,
    };
    let heads = match &options.network_heads {
        Some(p) => networks::heads_from_json(&read(p)?)?,
        None => {
            let mut heads = Vec::new();
            for url in networks::head_urls(&page)? {
                heads.push(live.head(&url).await?);
            }
            heads
        }
    };
    let networks = networks::networks(&page, &heads)?;

    let mut redist = Redist::new();
    for (name, url) in nvidia::json_urls() {
        let text = match &options.nvidia_dir {
            Some(dir) => read(&dir.join(&name))?,
            None => live.text(&url).await?,
        };
        let json = serde_json::from_str(&text).map_err(|e| format!("{name}: {e}"))?;
        redist.insert(name, json);
    }
    let mut text_sha256 = BTreeMap::new();
    let fixed = options
        .licence_texts
        .as_deref()
        .map(|p| std::fs::read(p).map_err(|e| format!("{}: {e}", p.display())))
        .transpose()?;
    for url in nvidia::text_urls(&redist)? {
        let sha = match &fixed {
            Some(bytes) => crate::sha256_hex(bytes),
            None => crate::sha256_hex(&live.bytes(&url).await?),
        };
        text_sha256.insert(url, sha);
    }
    let runtimes = nvidia::runtimes(&redist, &text_sha256)?;

    let sequence = options.sequence.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs())
    });
    let manifest = Manifest {
        schema: SCHEMA,
        sequence,
        generated: rfc3339(sequence),
        engines,
        runtimes,
        networks,
    };
    check_coverage(&manifest)?;
    let bytes = to_bytes(&manifest)?;
    parse_manifest(&bytes).map_err(|e| format!("the generated manifest does not parse: {e}"))?;
    Ok(bytes)
}

/// Every shipped platform must keep its rows in the engine list (in any version: KataGo's
/// newest release can be CUDA only), so that a failed or
/// renamed upstream list cannot silently drop a platform from a signed manifest.
fn check_coverage(m: &Manifest) -> Result<(), String> {
    use aji_manager::manifest::{Backend as B, Platform as P};
    const CUDA: [&str; 2] = ["cuda13.2-cudnn9.24.0", "cuda12.8-cudnn9.8.0"];
    let mut missing = Vec::new();
    let mut need = |platform: P, name: &str, backend: B, variant: Option<&str>| {
        let found = m.engines.iter().any(|e| {
            e.platform == platform && e.backend == backend && variant.is_none_or(|v| e.variant == v)
        });
        if !found {
            missing.push(format!(
                "{name} {}",
                variant.unwrap_or(&format!("{backend:?}").to_lowercase())
            ));
        }
    };
    need(P::MacosArm64, "macos-arm64", B::Metal, None);
    for v in CUDA {
        need(P::WindowsX64, "windows-x64", B::Cuda, Some(v));
    }
    for b in [B::Directml, B::Opencl, B::Eigenavx2, B::Eigen] {
        need(P::WindowsX64, "windows-x64", b, None);
    }
    for b in [B::Opencl, B::Eigenavx2, B::Eigen] {
        need(P::LinuxX64, "linux-x64", b, None);
    }
    for id in CUDA.map(|v| format!("nvidia-{v}-windows-x64")) {
        if !m.runtimes.iter().any(|r| r.id == id) {
            missing.push(format!("runtime {id}"));
        }
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "the manifest would drop shipped rows, not writing it; missing: {}",
            missing.join(", ")
        ))
    }
}

/// Engines by platform, backend and variant, newest version first. The input order of equal
/// keys does not matter: ids are unique.
fn sort_engines(mut engines: Vec<Engine>) -> Vec<Engine> {
    let key = |e: &Engine| {
        (
            serde_json::to_string(&e.platform).unwrap_or_default(),
            serde_json::to_string(&e.backend).unwrap_or_default(),
            e.variant.clone(),
        )
    };
    engines.sort_by(|a, b| key(a).cmp(&key(b)).then_with(|| b.version.cmp(&a.version)));
    engines
}

fn to_bytes(manifest: &Manifest) -> Result<Vec<u8>, String> {
    let value = serde_json::to_value(manifest).map_err(|e| e.to_string())?;
    let mut bytes = serde_json::to_vec_pretty(&canonical(value)).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Rebuilds a value with object keys in sorted order and `null` fields left out, which the
/// parser reads as absent.
fn canonical(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut entries: Vec<_> = map.into_iter().filter(|(_, v)| !v.is_null()).collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(k, v)| (k, canonical(v)))
                    .collect::<Map<_, _>>(),
            )
        }
        Value::Array(items) => Value::Array(items.into_iter().map(canonical).collect()),
        other => other,
    }
}

/// `YYYY-MM-DDTHH:MM:SSZ` for seconds since 1970.
fn rfc3339(secs: u64) -> String {
    let (days, rem) = (secs / 86400, secs % 86400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Parses the `generate` flags.
pub fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut o = Options::default();
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let mut value = || {
            it.next()
                .cloned()
                .ok_or_else(|| format!("{flag} needs a value"))
        };
        match flag.as_str() {
            "--out" => o.out = Some(value()?.into()),
            "--sequence" => {
                o.sequence = Some(
                    value()?
                        .parse()
                        .map_err(|_| "--sequence needs a whole number".to_owned())?,
                )
            }
            "--katago-releases" => o.katago_releases = Some(value()?.into()),
            "--metal-releases" => o.metal_releases = Some(value()?.into()),
            "--networks-page" => o.networks_page = Some(value()?.into()),
            "--network-heads" => o.network_heads = Some(value()?.into()),
            "--nvidia-dir" => o.nvidia_dir = Some(value()?.into()),
            "--licence-texts" => o.licence_texts = Some(value()?.into()),
            other => return Err(format!("unknown flag {other}")),
        }
    }
    Ok(o)
}
