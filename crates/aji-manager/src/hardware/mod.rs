//! Hardware detection: the OS, CPU, memory and GPUs Aji picks an engine backend from.
//!
//! The parsers are pure and compile on every OS, so a recorded capture can be checked anywhere.
//! The probes that read the live machine sit behind `cfg(target_os)`.

mod dxgi;
mod linux;
mod macos;
mod nvidia_smi;
mod windows;

#[cfg(test)]
mod tests;

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use dxgi::{DxgiAdapter, gpus_from_dxgi, nvidia_driver_from_umd};
pub use linux::gpus_from_sysfs;
pub use macos::gpus_from_system_profiler;
pub use nvidia_smi::{NvidiaSmiGpu, parse_nvidia_smi, parse_nvidia_smi_compute_cap};
pub use windows::report_from_windows_capture;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum OsKind {
    Windows,
    Macos,
    Linux,
    Other,
}

impl OsKind {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "linux") {
            Self::Linux
        } else {
            Self::Other
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HardwareReport {
    pub os: OsReport,
    pub cpu: CpuReport,
    #[ts(type = "number")]
    pub memory_bytes: u64,
    pub gpus: Vec<GpuReport>,
    /// One entry for each probe that failed. A failed probe never fails the report.
    pub problems: Vec<Probe>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OsReport {
    pub kind: OsKind,
    pub version: String,
    pub arch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CpuReport {
    pub name: String,
    pub cores: u32,
    pub threads: u32,
    pub avx2: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GpuReport {
    pub vendor: GpuVendor,
    pub name: String,
    #[ts(type = "number | null")]
    pub memory_bytes: Option<u64>,
    pub driver_version: Option<String>,
    pub pci_device_id: Option<u16>,
    pub apple_gpu_cores: Option<u32>,
    pub compute_capability: Option<String>,
    /// A software renderer such as the Microsoft Basic Render Driver.
    pub software: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum GpuVendor {
    Nvidia,
    Amd,
    Intel,
    Apple,
    Microsoft,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Probe {
    SystemProfiler,
    Dxgi,
    NvidiaSmi,
    Sysfs,
}

/// Probe output that did not have the expected shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError(pub String);

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ParseError {}

impl GpuReport {
    pub(crate) fn new(vendor: GpuVendor, name: String) -> Self {
        Self {
            vendor,
            name,
            memory_bytes: None,
            driver_version: None,
            pci_device_id: None,
            apple_gpu_cores: None,
            compute_capability: None,
            software: false,
        }
    }
}

/// Detects the hardware of this machine. Probes run off the async threads; a failed probe adds
/// to `problems` and the report still comes back.
pub async fn detect() -> HardwareReport {
    let base = tokio::task::spawn_blocking(basic_facts)
        .await
        .unwrap_or_else(|_| BasicFacts::unknown());
    let (gpus, problems) = detect_gpus().await;
    HardwareReport {
        os: OsReport {
            kind: OsKind::current(),
            version: base.os_version,
            arch: std::env::consts::ARCH.to_string(),
        },
        cpu: base.cpu,
        memory_bytes: base.memory_bytes,
        gpus,
        problems,
    }
}

#[cfg(target_os = "macos")]
async fn detect_gpus() -> (Vec<GpuReport>, Vec<Probe>) {
    macos::probe().await
}

#[cfg(target_os = "windows")]
async fn detect_gpus() -> (Vec<GpuReport>, Vec<Probe>) {
    windows::probe().await
}

#[cfg(target_os = "linux")]
async fn detect_gpus() -> (Vec<GpuReport>, Vec<Probe>) {
    linux::probe().await
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
async fn detect_gpus() -> (Vec<GpuReport>, Vec<Probe>) {
    (Vec::new(), Vec::new())
}

struct BasicFacts {
    os_version: String,
    cpu: CpuReport,
    memory_bytes: u64,
}

impl BasicFacts {
    fn unknown() -> Self {
        Self {
            os_version: String::new(),
            cpu: CpuReport {
                name: String::new(),
                cores: 1,
                threads: 1,
                avx2: false,
            },
            memory_bytes: 0,
        }
    }
}

fn basic_facts() -> BasicFacts {
    use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

    let system = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing())
            .with_memory(MemoryRefreshKind::nothing().with_ram()),
    );
    let (name, threads, memory_bytes) = match &system {
        Ok(system) => (
            system
                .cpus()
                .first()
                .map(|cpu| cpu.brand().trim().to_string())
                .unwrap_or_default(),
            system.cpus().len(),
            system.total_memory(),
        ),
        Err(_) => (String::new(), 0, 0),
    };
    let threads = threads
        .max(std::thread::available_parallelism().map_or(1, |n| n.get()))
        .max(1);
    let cores = System::physical_core_count()
        .unwrap_or(threads)
        .clamp(1, threads);
    BasicFacts {
        os_version: System::long_os_version().unwrap_or_default(),
        cpu: CpuReport {
            name,
            cores: cores as u32,
            threads: threads as u32,
            avx2: has_avx2(),
        },
        memory_bytes,
    }
}

fn has_avx2() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        is_x86_feature_detected!("avx2")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

/// Runs a program to completion within `limit` and returns its stdout. A non-zero exit is an
/// error carrying whatever the program printed, since nvidia-smi explains its failures on stdout.
pub(crate) async fn run_command(
    program: &std::path::Path,
    args: &[&str],
    limit: Duration,
) -> Result<String, ParseError> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let output = tokio::time::timeout(limit, command.output())
        .await
        .map_err(|_| ParseError(format!("{} timed out", program.display())))?
        .map_err(|e| ParseError(format!("{} did not run: {e}", program.display())))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(ParseError(format!(
            "{} failed with {}: {}{}",
            program.display(),
            output.status,
            stdout.trim(),
            stderr.trim()
        )))
    }
}
