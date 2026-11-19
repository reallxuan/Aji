//! Linux: GPUs from `/sys/class/drm`, named by `nvidia-smi` when it knows them.

use std::path::Path;

use super::dxgi::{VENDOR_AMD, VENDOR_INTEL, VENDOR_NVIDIA, is_software_vendor};
use super::{GpuReport, GpuVendor};

/// Reads `class/drm/card[0-9]*` under `root` (normally `/sys`). Connector entries such as
/// `card0-DP-1` are skipped. VRAM comes from `mem_info_vram_total`, which only amdgpu writes.
pub fn gpus_from_sysfs(root: &Path) -> Vec<GpuReport> {
    let Ok(entries) = std::fs::read_dir(root.join("class/drm")) else {
        return Vec::new();
    };
    let mut cards: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.strip_prefix("card")
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        })
        .map(|entry| (entry.file_name(), entry.path().join("device")))
        .collect();
    cards.sort();
    cards
        .into_iter()
        .filter_map(|(_, device)| {
            let vendor_id = read_hex(&device.join("vendor"))?;
            let device_id = read_hex(&device.join("device"))?;
            let (vendor, label) = match vendor_id {
                VENDOR_NVIDIA => (GpuVendor::Nvidia, "NVIDIA"),
                VENDOR_AMD => (GpuVendor::Amd, "AMD"),
                VENDOR_INTEL => (GpuVendor::Intel, "Intel"),
                _ => (GpuVendor::Other, "Unknown"),
            };
            let mut gpu = GpuReport::new(vendor, format!("{label} GPU 0x{device_id:04x}"));
            gpu.software = is_software_vendor(vendor_id);
            gpu.pci_device_id = u16::try_from(device_id).ok();
            gpu.memory_bytes = std::fs::read_to_string(device.join("mem_info_vram_total"))
                .ok()
                .and_then(|t| t.trim().parse().ok());
            Some(gpu)
        })
        .collect()
}

fn read_hex(path: &Path) -> Option<u32> {
    let text = std::fs::read_to_string(path).ok()?;
    let text = text.trim();
    u32::from_str_radix(text.strip_prefix("0x").unwrap_or(text), 16).ok()
}

#[cfg(target_os = "linux")]
pub(super) async fn probe() -> (Vec<GpuReport>, Vec<super::Probe>) {
    use super::{Probe, nvidia_smi};

    let sys = Path::new("/sys");
    if !sys.join("class/drm").is_dir() {
        return (Vec::new(), vec![Probe::Sysfs]);
    }
    let mut gpus = tokio::task::spawn_blocking(|| gpus_from_sysfs(Path::new("/sys")))
        .await
        .unwrap_or_default();
    let mut problems = Vec::new();
    if gpus.iter().any(|g| g.vendor == GpuVendor::Nvidia) {
        match nvidia_smi::query(Path::new("nvidia-smi")).await {
            Ok(data) => {
                nvidia_smi::fill_from_nvidia_smi(&mut gpus, &data.gpus, &data.caps);
                if !data.caps_ok {
                    problems.push(Probe::NvidiaSmi);
                }
            }
            Err(_) => problems.push(Probe::NvidiaSmi),
        }
    }
    (gpus, problems)
}
