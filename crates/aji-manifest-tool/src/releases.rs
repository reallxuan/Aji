//! Engines from GitHub release listings.
//!
//! Only the Phase 1 allow-list is kept. Each engine carries GitHub's own asset `digest`, so no
//! package is downloaded to be hashed.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use aji_manager::manifest::{Backend, Digest, Engine, FileRef, Platform};
use regex::Regex;
use serde::Deserialize;

/// Which repository a release listing came from.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// `lightvector/KataGo`.
    KataGo,
    /// `reallxuan/aji-manifest`, which hosts the Metal build.
    Metal,
}

#[derive(Deserialize)]
struct Release {
    published_at: String,
    assets: Vec<Asset>,
    /// Drafts and prereleases are not offered to users.
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    digest: Option<String>,
    browser_download_url: String,
}

static ASSET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^katago-v(?<ver>[0-9.]+)-(?<tag>.+)\.zip$").unwrap());

/// One allow-list row: the asset tag pattern (group 1 is the variant) and what it makes of an
/// engine.
struct Rule {
    pattern: Regex,
    platform: Platform,
    backend: Backend,
    runtime: bool,
    onnx_provider: Option<&'static str>,
    family_group: Option<usize>,
}

fn rule(pattern: &str, platform: Platform, backend: Backend) -> Rule {
    Rule {
        pattern: Regex::new(&format!("^{pattern}$")).unwrap(),
        platform,
        backend,
        runtime: false,
        onnx_provider: None,
        family_group: None,
    }
}

static RULES: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    use Backend::*;
    use Platform::*;
    let win = WindowsX64;
    let mut v = vec![
        Rule {
            runtime: true,
            ..rule(r"(cuda13\.2-cudnn9\.24\.0)-windows-x64", win, Cuda)
        },
        Rule {
            runtime: true,
            ..rule(r"(cuda12\.8-cudnn9\.8\.0)-windows-x64", win, Cuda)
        },
        Rule {
            onnx_provider: Some("directml"),
            ..rule(r"(onnx[0-9.]+-directml)-windows-x64", win, Directml)
        },
        Rule {
            onnx_provider: Some("openvino"),
            ..rule(r"(onnx-openvino[0-9.]*)-windows-x64", win, Openvino)
        },
        Rule {
            family_group: Some(2),
            ..rule(
                r"(rocm[0-9.]+-(gfx103X|gfx110X|gfx1151|gfx120X))-windows-x64",
                win,
                Rocm,
            )
        },
    ];
    for (name, backend) in [
        ("opencl", Opencl),
        ("eigenavx2", Eigenavx2),
        ("eigen", Eigen),
    ] {
        v.push(rule(&format!("({name})-windows-x64"), win, backend));
        v.push(rule(&format!("({name})-linux-x64"), LinuxX64, backend));
    }
    v
});

/// The oldest engine version listed; the first to load transformer networks.
const FIRST_VERSION: semver::Version = semver::Version::new(1, 17, 0);

/// Builds the engines of a release listing that the allow-list admits and that are v1.17.0 or
/// later. `json` is a GitHub releases answer (`tag_name` is not used, the asset name is).
pub fn engines(json: &str, source: Source) -> Result<Vec<Engine>, String> {
    let releases: Vec<Release> =
        serde_json::from_str(json).map_err(|e| format!("release list: {e}"))?;
    let mut out = Vec::new();
    for release in releases.iter().filter(|r| !r.draft && !r.prerelease) {
        for asset in &release.assets {
            if let Some(engine) = engine(release, asset, source)? {
                out.push(engine);
            }
        }
    }
    if source == Source::KataGo && out.is_empty() {
        return Err(
            "no KataGo engine matches the allow-list: the releases may have changed".into(),
        );
    }
    out.sort_by(|a, b| {
        (
            platform_name(a.platform),
            backend_name(a.backend),
            &a.variant,
        )
            .cmp(&(
                platform_name(b.platform),
                backend_name(b.backend),
                &b.variant,
            ))
            .then_with(|| b.version.cmp(&a.version))
    });
    Ok(out)
}

fn engine(release: &Release, asset: &Asset, source: Source) -> Result<Option<Engine>, String> {
    let Some(c) = ASSET.captures(&asset.name) else {
        return Ok(None);
    };
    let version = match semver::Version::parse(&c["ver"]) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    if version < FIRST_VERSION {
        return Ok(None);
    }
    let tag = &c["tag"];
    let (platform, backend, variant, runtime, config, gpu_family);
    match source {
        Source::Metal => {
            if tag != "metal-macos-arm64" {
                return Ok(None);
            }
            platform = Platform::MacosArm64;
            backend = Backend::Metal;
            variant = "metal".to_owned();
            runtime = None;
            config = BTreeMap::new();
            gpu_family = None;
        }
        Source::KataGo => {
            let Some((rule, m)) = RULES
                .iter()
                .find_map(|r| r.pattern.captures(tag).map(|m| (r, m)))
            else {
                return Ok(None);
            };
            platform = rule.platform;
            backend = rule.backend;
            variant = m[1].to_owned();
            runtime = rule
                .runtime
                .then(|| format!("nvidia-{variant}-windows-x64"));
            config = rule
                .onnx_provider
                .map(|p| ("onnxProvider".to_owned(), p.to_owned()))
                .into_iter()
                .collect();
            gpu_family = rule.family_group.map(|g| m[g].to_owned());
        }
    }
    let digest = asset
        .digest
        .as_deref()
        .ok_or_else(|| format!("asset {} has no digest", asset.name))?;
    let digest = Digest::parse(digest).map_err(|e| format!("asset {}: {e}", asset.name))?;
    Ok(Some(Engine {
        id: asset.name.trim_end_matches(".zip").to_owned(),
        version,
        released: crate::date_of(&release.published_at)?,
        platform,
        backend,
        variant,
        runtime,
        gpu_family,
        config,
        file: FileRef {
            name: asset.name.clone(),
            size: asset.size,
            digest,
            urls: vec![asset.browser_download_url.clone()],
        },
    }))
}

fn platform_name(p: Platform) -> &'static str {
    match p {
        Platform::WindowsX64 => "windows-x64",
        Platform::MacosArm64 => "macos-arm64",
        Platform::LinuxX64 => "linux-x64",
        Platform::Unknown => "unknown",
    }
}

fn backend_name(b: Backend) -> &'static str {
    match b {
        Backend::Cuda => "cuda",
        Backend::Directml => "directml",
        Backend::Openvino => "openvino",
        Backend::Rocm => "rocm",
        Backend::Opencl => "opencl",
        Backend::Metal => "metal",
        Backend::Eigenavx2 => "eigenavx2",
        Backend::Eigen => "eigen",
        Backend::Unknown => "unknown",
    }
}
