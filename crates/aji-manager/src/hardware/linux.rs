//! Linux: GPUs from `/sys/class/drm` and `/sys/bus/pci/devices`, named by `nvidia-smi` when it
//! knows them.

use std::fs;
use std::path::{Path, PathBuf};

use super::dxgi::{VENDOR_AMD, VENDOR_INTEL, VENDOR_NVIDIA, is_software_vendor};
use super::{GpuReport, GpuVendor};

/// PCI base class 0x03: display controllers (VGA 0x0300, 3D 0x0302, other 0x0380).
const PCI_CLASS_DISPLAY: u32 = 0x03;

/// Reads the GPUs under `root` (normally `/sys`): first `class/drm/card[0-9]*`, then each display
/// controller in `bus/pci/devices` that DRM did not list, such as an NVIDIA card whose
/// proprietary driver runs without `nvidia-drm`. In a real sysfs both are links to one device
/// folder, so a card is counted once. Connector entries such as `card0-DP-1` are skipped. VRAM
/// comes from `mem_info_vram_total`, which only amdgpu writes.
pub fn gpus_from_sysfs(root: &Path) -> Vec<GpuReport> {
    let mut devices = drm_devices(root);
    let seen: Vec<PathBuf> = devices
        .iter()
        .filter_map(|d| fs::canonicalize(d).ok())
        .collect();
    devices.extend(
        pci_display_devices(root)
            .into_iter()
            .filter(|d| fs::canonicalize(d).map_or(true, |c| !seen.contains(&c))),
    );
    devices.iter().filter_map(|d| gpu_from_device(d)).collect()
}

/// The `device` folders of `class/drm/card[0-9]*`, in card order.
fn drm_devices(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root.join("class/drm")) else {
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
    cards.into_iter().map(|(_, device)| device).collect()
}

/// The PCI functions whose class is a display controller, in address order.
fn pci_display_devices(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root.join("bus/pci/devices")) else {
        return Vec::new();
    };
    let mut devices: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            read_hex(&path.join("class")).is_some_and(|class| class >> 16 == PCI_CLASS_DISPLAY)
        })
        .collect();
    devices.sort();
    devices
}

fn gpu_from_device(device: &Path) -> Option<GpuReport> {
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
    gpu.memory_bytes = fs::read_to_string(device.join("mem_info_vram_total"))
        .ok()
        .and_then(|t| t.trim().parse().ok());
    Some(gpu)
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
    let mut problems = Vec::new();
    if !sys.join("class/drm").is_dir() && !sys.join("bus/pci/devices").is_dir() {
        let why = "/sys has neither class/drm nor bus/pci/devices";
        super::record_problem(&mut problems, Probe::Sysfs, &why);
        return (Vec::new(), problems);
    }
    let mut gpus = tokio::task::spawn_blocking(|| gpus_from_sysfs(Path::new("/sys")))
        .await
        .unwrap_or_default();
    if gpus.iter().any(|g| g.vendor == GpuVendor::Nvidia) {
        match nvidia_smi::query(Path::new("nvidia-smi")).await {
            Ok(data) => {
                nvidia_smi::fill_from_nvidia_smi(&mut gpus, &data.gpus, &data.caps);
                if let Some(e) = &data.caps_error {
                    super::record_problem(&mut problems, Probe::NvidiaSmi, e);
                }
            }
            Err(e) => super::record_problem(&mut problems, Probe::NvidiaSmi, &e),
        }
    }
    (gpus, problems)
}
