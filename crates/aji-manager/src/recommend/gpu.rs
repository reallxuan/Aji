//! Which GPU to use and the backend table.

use std::cmp::Reverse;
use std::sync::LazyLock;

use regex::Regex;

use super::{BackendTag, RecommendationNote};
use crate::hardware::{GpuReport, GpuVendor, HardwareReport, OsKind};
use crate::manifest::{Backend, Engine, Manifest, Platform};

/// The newest Windows driver and GPU the CUDA 13.2 runtime set supports.
const CUDA13_DRIVER: &str = "580.00";
const CUDA13_COMPUTE_CAPABILITY: &str = "7.5";
/// The oldest Windows driver for the CUDA 12.8 runtime set.
const CUDA12_DRIVER: &str = "572.61";

const CUDA13: &str = "cuda13.2-cudnn9.24.0";
const CUDA12: &str = "cuda12.8-cudnn9.8.0";

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
    let (wanted, max_fallbacks, mut notes) = table(platform, report, gpu);
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
    let generic = || vec![any(Backend::Directml), any(Backend::Opencl)];
    let with_first = |first: Pick| {
        let mut v = vec![first];
        v.extend(generic());
        v
    };
    match gpu.vendor {
        GpuVendor::Nvidia => {
            let driver = gpu.driver_version.as_deref();
            let cc = gpu.compute_capability.as_deref();
            let at_least = |v: Option<&str>, min: &str| matches!((v.and_then(dotted), dotted(min)), (Some(a), Some(b)) if a >= b);
            if at_least(driver, CUDA13_DRIVER) && at_least(cc, CUDA13_COMPUTE_CAPABILITY) {
                (
                    with_first(pick(Backend::Cuda, Need::Variant(CUDA13))),
                    usize::MAX,
                    vec![],
                )
            } else if at_least(driver, CUDA12_DRIVER) {
                (
                    with_first(pick(Backend::Cuda, Need::Variant(CUDA12))),
                    usize::MAX,
                    vec![],
                )
            } else {
                (generic(), usize::MAX, vec![DriverTooOldForCuda])
            }
        }
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
