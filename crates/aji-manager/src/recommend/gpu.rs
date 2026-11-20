//! Which GPU to use and the backend table.

use std::cmp::Reverse;
use std::sync::LazyLock;

use regex::Regex;

use super::{BackendTag, RecommendationNote};
use crate::hardware::{GpuReport, GpuVendor, HardwareReport, OsKind};
use crate::manifest::{Backend, Engine, Manifest, Platform, Runtime};

const CUDA13: &str = "cuda13.2-cudnn9.24.0";
const CUDA12: &str = "cuda12.8-cudnn9.8.0";
/// The CUDA variants, best first. Their driver and compute-capability limits come from the
/// manifest's runtimes, so a wrong limit is fixed by publishing a new manifest.
const CUDA_VARIANTS: [&str; 2] = [CUDA13, CUDA12];

/// Which of a backend's engines this hardware needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Need {
    Any,
    Variant(&'static str),
    GpuFamily(&'static str),
}

#[derive(Debug, Clone)]
pub(super) struct Pick {
    pub backend: Backend,
    need: Need,
}

impl Pick {
    pub fn matches(&self, e: &Engine) -> bool {
        e.backend == self.backend
            && match self.need {
                Need::Any => true,
                Need::Variant(v) => e.variant == v,
                Need::GpuFamily(f) => e.gpu_family.as_deref() == Some(f),
            }
    }
}

pub(super) struct Plan<'a> {
    pub platform: Option<Platform>,
    pub gpu: Option<&'a GpuReport>,
    /// The backends this hardware can use and the manifest has an engine for, best first.
    pub picks: Vec<Pick>,
    /// How many of the picks after the first count as fallbacks.
    pub max_fallbacks: usize,
    pub notes: Vec<RecommendationNote>,
}

pub(super) fn tags(backend: Backend) -> Vec<BackendTag> {
    match backend {
        Backend::Cuda | Backend::Rocm | Backend::Openvino => vec![BackendTag::Fastest],
        Backend::Directml => vec![BackendTag::NoRuntimeDownload],
        Backend::Opencl => vec![BackendTag::MostCompatible, BackendTag::Slowest],
        Backend::Eigenavx2 | Backend::Eigen => vec![BackendTag::CpuOnly],
        Backend::Metal | Backend::Unknown => Vec::new(),
    }
}

fn platform(report: &HardwareReport) -> Option<Platform> {
    match (report.os.kind, report.os.arch.as_str()) {
        (OsKind::Windows, "x86_64") => Some(Platform::WindowsX64),
        (OsKind::Macos, "aarch64") => Some(Platform::MacosArm64),
        (OsKind::Linux, "x86_64") => Some(Platform::LinuxX64),
        _ => None,
    }
}

/// The GPU to use: software adapters are ignored, and the rest are ordered by vendor (NVIDIA,
/// Apple, AMD, Intel, the others), then by memory, largest first.
fn choose_gpu(report: &HardwareReport) -> Option<&GpuReport> {
    let rank = |v: GpuVendor| match v {
        GpuVendor::Nvidia => 0,
        GpuVendor::Apple => 1,
        GpuVendor::Amd => 2,
        GpuVendor::Intel => 3,
        GpuVendor::Microsoft | GpuVendor::Other => 4,
    };
    report
        .gpus
        .iter()
        .filter(|g| !g.software)
        .min_by_key(|g| (rank(g.vendor), Reverse(g.memory_bytes.unwrap_or(0))))
}

pub(super) fn plan<'a>(report: &'a HardwareReport, manifest: &Manifest) -> Plan<'a> {
    let gpu = choose_gpu(report);
    let Some(platform) = platform(report) else {
        return Plan {
            platform: None,
            gpu,
            picks: Vec::new(),
            max_fallbacks: 0,
            notes: vec![RecommendationNote::UnsupportedPlatform],
        };
    };
    let (wanted, max_fallbacks, mut notes) = table(platform, report, gpu, manifest);
    let total = wanted.len();
    let picks: Vec<Pick> = wanted
        .into_iter()
        .filter(|p| {
            manifest
                .engines
                .iter()
                .any(|e| e.platform == platform && p.matches(e))
        })
        .collect();
    if picks.len() < total {
        notes.push(RecommendationNote::NoEngineForBackend);
    }
    Plan {
        platform: Some(platform),
        gpu,
        picks,
        max_fallbacks,
        notes,
    }
}

fn pick(backend: Backend, need: Need) -> Pick {
    Pick { backend, need }
}

/// The table rows: the wanted backends in order, how many fallbacks follow the default, and notes.
fn table(
    platform: Platform,
    report: &HardwareReport,
    gpu: Option<&GpuReport>,
    manifest: &Manifest,
) -> (Vec<Pick>, usize, Vec<RecommendationNote>) {
    use RecommendationNote::*;
    let any = |b| pick(b, Need::Any);
    let cpu = || {
        let mut v = Vec::new();
        if report.cpu.avx2 {
            v.push(any(Backend::Eigenavx2));
        }
        v.push(any(Backend::Eigen));
        v
    };
    // An Apple Silicon Mac has an Apple GPU and no CPU engine exists for it, so Metal applies
    // even when the GPU probe failed.
    if platform == Platform::MacosArm64 {
        return (vec![any(Backend::Metal)], 0, Vec::new());
    }
    let Some(gpu) = gpu else {
        return (cpu(), usize::MAX, vec![NoUsableGpu]);
    };
    if platform == Platform::LinuxX64 {
        let mut v = vec![any(Backend::Opencl)];
        v.extend(cpu());
        return (v, 1, Vec::new());
    }
    // R20: every GPU row ends with the CPU build, so a GPU that fails leaves a way out.
    let generic = || {
        let mut v = vec![any(Backend::Directml), any(Backend::Opencl)];
        v.extend(cpu());
        v
    };
    let with_first = |first: Pick| {
        let mut v = vec![first];
        v.extend(generic());
        v
    };
    match gpu.vendor {
        GpuVendor::Nvidia => match cuda_variant(manifest, platform, gpu) {
            Cuda::Variant(v) => (
                with_first(pick(Backend::Cuda, Need::Variant(v))),
                usize::MAX,
                vec![],
            ),
            Cuda::NoEngine => (generic(), usize::MAX, vec![NoEngineForBackend]),
            Cuda::TooOld => (generic(), usize::MAX, vec![DriverTooOldForCuda]),
        },
        GpuVendor::Amd => match amd_family(&gpu.name) {
            Some(f) => (
                with_first(pick(Backend::Rocm, Need::GpuFamily(f))),
                usize::MAX,
                vec![],
            ),
            None => (generic(), usize::MAX, vec![UnknownAmdFamily]),
        },
        GpuVendor::Intel => (with_first(any(Backend::Openvino)), usize::MAX, vec![]),
        // Any other adapter that is not a software renderer still runs DirectML.
        _ => (generic(), usize::MAX, vec![]),
    }
}

enum Cuda {
    Variant(&'static str),
    /// The manifest has no CUDA engine for this platform.
    NoEngine,
    /// The driver or the GPU is below every CUDA runtime's limits.
    TooOld,
}

/// The best CUDA variant for this GPU. A variant counts when the manifest has an engine for it;
/// it is usable when the driver is known and meets its runtime's `minDriver` (a runtime without
/// one is never usable) and the GPU meets its `minComputeCapability`. An unknown compute
/// capability (no nvidia-smi) takes the usable variant with the lowest minimum: it runs on the
/// most cards, and a Pascal card must not get CUDA 13, which dropped it.
fn cuda_variant(manifest: &Manifest, platform: Platform, gpu: &GpuReport) -> Cuda {
    let present: Vec<&'static str> = CUDA_VARIANTS
        .into_iter()
        .filter(|v| cuda_engine(manifest, platform, v).is_some())
        .collect();
    if present.is_empty() {
        return Cuda::NoEngine;
    }
    let Some(driver) = gpu.driver_version.as_deref().and_then(dotted) else {
        return Cuda::TooOld;
    };
    // Each variant the driver allows, with its minimum compute capability: empty for none,
    // `None` for one that does not parse.
    let allowed: Vec<(&'static str, Option<Vec<u64>>)> = present
        .into_iter()
        .filter_map(|v| {
            let runtime = cuda_runtime(manifest, platform, v)?;
            let min_driver = dotted(runtime.min_driver.as_deref()?)?;
            let min_cc = match runtime.min_compute_capability.as_deref() {
                None => Some(Vec::new()),
                Some(min) => dotted(min),
            };
            (driver >= min_driver).then_some((v, min_cc))
        })
        .collect();
    let chosen = match gpu.compute_capability.as_deref().and_then(dotted) {
        Some(cc) => allowed
            .iter()
            .find(|(_, min)| min.as_ref().is_some_and(|min| cc >= *min)),
        None => allowed
            .iter()
            .filter(|(_, min)| min.is_some())
            .min_by(|a, b| a.1.cmp(&b.1)),
    };
    chosen.map_or(Cuda::TooOld, |(v, _)| Cuda::Variant(v))
}

/// The `minDriver` of the CUDA runtime this GPU would get if its driver were new enough: the
/// first variant whose compute-capability minimum the GPU meets, or, with an unknown compute
/// capability, the variant with the lowest minimum (as [`cuda_variant`] chooses). `None` when the
/// manifest has no CUDA build with a driver minimum for this platform.
pub fn required_driver(manifest: &Manifest, platform: Platform, gpu: &GpuReport) -> Option<String> {
    let candidates: Vec<(&str, Option<Vec<u64>>)> = CUDA_VARIANTS
        .into_iter()
        .filter(|v| cuda_engine(manifest, platform, v).is_some())
        .filter_map(|v| {
            let runtime = cuda_runtime(manifest, platform, v)?;
            runtime.min_driver.as_deref().and_then(dotted)?;
            let min_cc = match runtime.min_compute_capability.as_deref() {
                None => Some(Vec::new()),
                Some(min) => dotted(min),
            };
            Some((runtime.min_driver.as_deref()?, min_cc))
        })
        .collect();
    let chosen = match gpu.compute_capability.as_deref().and_then(dotted) {
        Some(cc) => candidates
            .iter()
            .find(|(_, min)| min.as_ref().is_some_and(|min| cc >= *min)),
        None => candidates
            .iter()
            .filter(|(_, min)| min.is_some())
            .min_by(|a, b| a.1.cmp(&b.1)),
    };
    chosen.map(|(driver, _)| (*driver).to_owned())
}

fn cuda_engine<'m>(
    manifest: &'m Manifest,
    platform: Platform,
    variant: &str,
) -> Option<&'m Engine> {
    manifest
        .engines
        .iter()
        .find(|e| e.platform == platform && e.backend == Backend::Cuda && e.variant == variant)
}

/// The runtime named by the variant's engines on this platform.
fn cuda_runtime<'m>(
    manifest: &'m Manifest,
    platform: Platform,
    variant: &str,
) -> Option<&'m Runtime> {
    let id = manifest
        .engines
        .iter()
        .filter(|e| e.platform == platform && e.backend == Backend::Cuda && e.variant == variant)
        .find_map(|e| e.runtime.as_deref())?;
    manifest.runtimes.iter().find(|r| r.id == id)
}

/// Parses `580.00` or `7.5` into its numbers, so `1000.1` is above `580.00`.
fn dotted(s: &str) -> Option<Vec<u64>> {
    let mut parts: Vec<u64> = s
        .trim()
        .split('.')
        .map(|p| p.parse().ok())
        .collect::<Option<_>>()?;
    // 7.5 equals 7.5.0, so trailing zeros do not matter.
    while parts.len() > 1 && parts.last() == Some(&0) {
        parts.pop();
    }
    Some(parts)
}

fn amd_family(name: &str) -> Option<&'static str> {
    static FAMILIES: LazyLock<[(Regex, &'static str); 4]> = LazyLock::new(|| {
        let re = |p: &str| Regex::new(&format!("(?i){p}")).expect("valid pattern");
        [
            (re(r"RX 6\d{3}"), "gfx103X"),
            (re(r"RX 7\d{3}"), "gfx110X"),
            (re(r"RX 9\d{3}"), "gfx120X"),
            (re(r"Radeon 80[56]0S"), "gfx1151"),
        ]
    });
    FAMILIES
        .iter()
        .find(|(re, _)| re.is_match(name))
        .map(|(_, f)| *f)
}
