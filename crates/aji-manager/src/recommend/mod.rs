//! What to install on this machine: a backend, an engine version and a network.
//!
//! The rules are charter 6.3 as amended by R1 and NVIDIA's CUDA 13 notes. They read the hardware
//! report and the manifest, and never measure anything.

mod gpu;
mod networks;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::hardware::{GpuReport, HardwareReport};
use crate::manifest::{Backend, Manifest, Platform};

pub use gpu::required_driver;
pub use networks::networks;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackendRecommendation {
    /// `None` when Aji has no engine builds for this OS and CPU.
    pub platform: Option<Platform>,
    /// The GPU the choice is based on, if one was usable.
    pub gpu: Option<GpuReport>,
    pub backends: Vec<BackendChoice>,
    pub default: Option<Backend>,
    pub fallbacks: Vec<Backend>,
    pub notes: Vec<RecommendationNote>,
    /// Set when the NVIDIA driver is too old for any CUDA build: the wizard shows CUDA disabled
    /// and names the driver version that would unlock it.
    pub driver: Option<DriverAdvice>,
}

/// The driver the GPU has, and the one the CUDA build for this GPU needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DriverAdvice {
    /// `None` when the driver version could not be read.
    pub current: Option<String>,
    /// The `minDriver` of that CUDA build's runtime, as the manifest writes it.
    pub required: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackendChoice {
    pub backend: Backend,
    pub tags: Vec<BackendTag>,
}

/// The wizard shows `fastest` as 最快, `noRuntimeDownload` as 免运行库, and `mostCompatible`
/// with `slowest` as 兼容性最好，最慢.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum BackendTag {
    Fastest,
    NoRuntimeDownload,
    MostCompatible,
    Slowest,
    CpuOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RecommendationNote {
    UnsupportedPlatform,
    NoUsableGpu,
    DriverTooOldForCuda,
    UnknownAmdFamily,
    NoEngineForBackend,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EngineVersionChoice {
    pub engine: String,
    pub version: String,
    pub released: String,
    #[ts(type = "number")]
    pub download_bytes: u64,
    /// The sum of the runtime's archive sizes, which is what the user downloads.
    #[ts(type = "number | null")]
    pub runtime_bytes: Option<u64>,
    pub latest: bool,
    /// Already in the install record, so choosing it downloads nothing. The service fills it in.
    #[serde(default)]
    pub installed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NetworkChoice {
    pub network: String,
    pub family: String,
    pub elo: Option<f64>,
    pub uploaded: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
    /// Already in the install record, so choosing it downloads nothing. The service fills it in.
    #[serde(default)]
    pub installed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NetworkList {
    /// Main networks the engine can load, highest Elo first.
    pub networks: Vec<NetworkChoice>,
    /// The first of `networks`. The rule is the same on every machine and backend.
    pub preselected: Option<String>,
    pub human: Option<NetworkChoice>,
}

pub fn recommend_backends(report: &HardwareReport, manifest: &Manifest) -> BackendRecommendation {
    let plan = gpu::plan(report, manifest);
    let backends: Vec<BackendChoice> = plan
        .picks
        .iter()
        .map(|p| BackendChoice {
            backend: p.backend,
            tags: gpu::tags(p.backend),
        })
        .collect();
    let default = backends.first().map(|c| c.backend);
    let fallbacks = backends
        .iter()
        .skip(1)
        .take(plan.max_fallbacks)
        .map(|c| c.backend)
        .collect();
    let driver = match (plan.platform, plan.gpu) {
        (Some(platform), Some(gpu))
            if plan
                .notes
                .contains(&RecommendationNote::DriverTooOldForCuda) =>
        {
            gpu::required_driver(manifest, platform, gpu).map(|required| DriverAdvice {
                current: gpu.driver_version.clone(),
                required,
            })
        }
        _ => None,
    };
    BackendRecommendation {
        platform: plan.platform,
        gpu: plan.gpu.cloned(),
        backends,
        default,
        fallbacks,
        notes: plan.notes,
        driver,
    }
}

/// The engine versions for `backend`, newest first, for the variant or GPU family this hardware
/// needs. Empty when the hardware's row does not list the backend.
pub fn versions(
    report: &HardwareReport,
    manifest: &Manifest,
    backend: Backend,
) -> Vec<EngineVersionChoice> {
    let plan = gpu::plan(report, manifest);
    let (Some(platform), Some(pick)) = (
        plan.platform,
        plan.picks.iter().find(|p| p.backend == backend),
    ) else {
        return Vec::new();
    };
    let mut engines: Vec<_> = manifest
        .engines
        .iter()
        .filter(|e| e.platform == platform && pick.matches(e))
        .collect();
    engines.sort_by(|a, b| b.version.cmp(&a.version));
    engines
        .iter()
        .enumerate()
        .map(|(i, e)| EngineVersionChoice {
            engine: e.id.clone(),
            version: e.version.to_string(),
            released: e.released.clone(),
            download_bytes: e.file.size,
            runtime_bytes: e.runtime.as_deref().and_then(|id| {
                manifest
                    .runtimes
                    .iter()
                    .find(|r| r.id == id)
                    .map(|r| r.components.iter().map(|c| c.archive.size).sum())
            }),
            latest: i == 0,
            installed: false,
        })
        .collect()
}
