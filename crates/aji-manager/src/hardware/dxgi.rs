//! DXGI adapters, as the Windows probe and the capture script both describe them.

use serde::{Deserialize, Deserializer};

use super::nvidia_smi::fill_from_nvidia_smi;
use super::{GpuReport, GpuVendor, NvidiaSmiGpu};

pub(super) const VENDOR_NVIDIA: u32 = 0x10DE;
pub(super) const VENDOR_AMD: u32 = 0x1002;
const VENDOR_AMD_ATI: u32 = 0x1022;
pub(super) const VENDOR_INTEL: u32 = 0x8086;
const VENDOR_MICROSOFT: u32 = 0x1414;
/// Virtual display adapters of VMware, VirtualBox, Parallels, QEMU/Bochs and virtio. They are not
/// real GPUs: a machine with only these gets the no-GPU row, like the Basic Render Driver.
const VM_VENDORS: [u32; 5] = [0x15AD, 0x80EE, 0x1AB8, 0x1234, 0x1AF4];

/// Whether `vendor_id` is the Microsoft software renderer or a virtual machine's display adapter.
pub(super) fn is_software_vendor(vendor_id: u32) -> bool {
    vendor_id == VENDOR_MICROSOFT || VM_VENDORS.contains(&vendor_id)
}
/// `DXGI_ADAPTER_FLAG_SOFTWARE`.
const FLAG_SOFTWARE: u32 = 2;

/// One DXGI adapter. It deserialises straight from the capture script's `dxgi` entries, whose
/// ids are `"0x10DE"` strings.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DxgiAdapter {
    pub description: String,
    #[serde(deserialize_with = "id")]
    pub vendor_id: u32,
    #[serde(deserialize_with = "id")]
    pub device_id: u32,
    pub dedicated_video_memory: u64,
    pub flags: u32,
    #[serde(default)]
    pub umd_version: Option<String>,
}

fn id<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Id {
        Number(u32),
        Text(String),
    }
    match Id::deserialize(deserializer)? {
        Id::Number(n) => Ok(n),
        Id::Text(text) => {
            let hex = text
                .strip_prefix("0x")
                .or_else(|| text.strip_prefix("0X"))
                .unwrap_or(&text);
            u32::from_str_radix(hex, 16).map_err(serde::de::Error::custom)
        }
    }
}

/// Builds the GPU list from DXGI, filling an NVIDIA adapter in from `nvidia-smi` by device id.
pub fn gpus_from_dxgi(
    adapters: &[DxgiAdapter],
    smi: &[NvidiaSmiGpu],
    caps: &[(u32, String)],
) -> Vec<GpuReport> {
    let mut gpus: Vec<GpuReport> = adapters
        .iter()
        .map(|adapter| {
            let vendor = match adapter.vendor_id {
                VENDOR_NVIDIA => GpuVendor::Nvidia,
                VENDOR_AMD | VENDOR_AMD_ATI => GpuVendor::Amd,
                VENDOR_INTEL => GpuVendor::Intel,
                VENDOR_MICROSOFT => GpuVendor::Microsoft,
                _ => GpuVendor::Other,
            };
            let mut gpu = GpuReport::new(vendor, adapter.description.clone());
            gpu.software =
                adapter.flags & FLAG_SOFTWARE != 0 || is_software_vendor(adapter.vendor_id);
            gpu.pci_device_id = u16::try_from(adapter.device_id).ok();
            gpu.memory_bytes = Some(adapter.dedicated_video_memory).filter(|&m| m > 0);
            gpu.driver_version = adapter.umd_version.clone();
            gpu
        })
        .collect();
    let matched = fill_from_nvidia_smi(&mut gpus, smi, caps);
    for ((gpu, matched), adapter) in gpus.iter_mut().zip(matched).zip(adapters) {
        if gpu.vendor == GpuVendor::Nvidia && !matched {
            gpu.driver_version = adapter
                .umd_version
                .as_deref()
                .and_then(nvidia_driver_from_umd);
        }
    }
    gpus
}

/// Turns a DXGI user-mode driver version into the NVIDIA driver version: the last digit of the
/// third part, then the fourth part zero-padded to four digits, read as `ddd.dd`.
/// `32.0.15.6094` gives `560.94`.
pub fn nvidia_driver_from_umd(umd: &str) -> Option<String> {
    let parts: Vec<&str> = umd.split('.').collect();
    let [_, _, third, fourth] = parts.as_slice() else {
        return None;
    };
    let last_digit = third.chars().last().filter(char::is_ascii_digit)?;
    let fourth: u32 = fourth.parse().ok().filter(|&n| n <= 9999)?;
    let digits = format!("{last_digit}{fourth:04}");
    Some(format!("{}.{}", &digits[..3], &digits[3..]))
}

/// Enumerates the DXGI adapters with `IDXGIFactory1::EnumAdapters1`. Not compiled on this
/// development Mac: it follows the `windows` 0.62 API and is exercised on Windows only.
#[cfg(windows)]
pub(super) fn enumerate() -> Result<Vec<DxgiAdapter>, super::ParseError> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, DXGI_ERROR_NOT_FOUND, IDXGIDevice, IDXGIFactory1,
    };
    use windows::core::Interface;

    let fail = |what: &str, e: windows::core::Error| super::ParseError(format!("{what}: {e}"));
    // SAFETY: plain COM calls on interfaces the `windows` crate owns and releases on drop; the
    // out values are filled in by the calls or the call returns an error.
    unsafe {
        let factory: IDXGIFactory1 =
            CreateDXGIFactory1().map_err(|e| fail("CreateDXGIFactory1", e))?;
        let mut adapters = Vec::new();
        for index in 0.. {
            let adapter = match factory.EnumAdapters1(index) {
                Ok(adapter) => adapter,
                Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(e) => return Err(fail("EnumAdapters1", e)),
            };
            let desc = adapter.GetDesc1().map_err(|e| fail("GetDesc1", e))?;
            let umd_version = adapter
                .CheckInterfaceSupport(&IDXGIDevice::IID)
                .ok()
                .map(|v| {
                    format!(
                        "{}.{}.{}.{}",
                        (v >> 48) & 0xFFFF,
                        (v >> 32) & 0xFFFF,
                        (v >> 16) & 0xFFFF,
                        v & 0xFFFF
                    )
                });
            let length = desc
                .Description
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(desc.Description.len());
            adapters.push(DxgiAdapter {
                description: String::from_utf16_lossy(&desc.Description[..length]),
                vendor_id: desc.VendorId,
                device_id: desc.DeviceId,
                dedicated_video_memory: desc.DedicatedVideoMemory as u64,
                flags: desc.Flags,
                umd_version,
            });
        }
        Ok(adapters)
    }
}
