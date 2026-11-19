//! macOS: the GPU list from `system_profiler`.

use super::{GpuReport, GpuVendor, ParseError};

/// Reads the GPUs from `system_profiler -json SPDisplaysDataType` output.
pub fn gpus_from_system_profiler(json: &str) -> Result<Vec<GpuReport>, ParseError> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| ParseError(format!("system_profiler JSON: {e}")))?;
    let entries = value
        .get("SPDisplaysDataType")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ParseError("system_profiler JSON has no SPDisplaysDataType".into()))?;
    let text = |entry: &serde_json::Value, key: &str| {
        entry.get(key).and_then(|v| v.as_str()).map(str::to_string)
    };
    Ok(entries
        .iter()
        .filter(|e| text(e, "sppci_device_type").as_deref() == Some("spdisplays_gpu"))
        .map(|entry| {
            let vendor_text = text(entry, "spdisplays_vendor").unwrap_or_default();
            let vendor = if vendor_text.contains("Apple") {
                GpuVendor::Apple
            } else if vendor_text.contains("Intel") {
                GpuVendor::Intel
            } else if vendor_text.contains("AMD") {
                GpuVendor::Amd
            } else {
                GpuVendor::Other
            };
            let name = text(entry, "sppci_model")
                .or_else(|| text(entry, "_name"))
                .unwrap_or_default();
            let mut gpu = GpuReport::new(vendor, name);
            gpu.apple_gpu_cores = text(entry, "sppci_cores").and_then(|c| c.trim().parse().ok());
            gpu
        })
        .collect())
}

#[cfg(target_os = "macos")]
pub(super) async fn probe() -> (Vec<GpuReport>, Vec<super::Probe>) {
    let output = super::run_command(
        std::path::Path::new("/usr/sbin/system_profiler"),
        &["-json", "SPDisplaysDataType", "SPHardwareDataType"],
        std::time::Duration::from_secs(15),
    )
    .await;
    match output.and_then(|json| gpus_from_system_profiler(&json)) {
        Ok(gpus) => (gpus, Vec::new()),
        Err(_) => (Vec::new(), vec![super::Probe::SystemProfiler]),
    }
}
