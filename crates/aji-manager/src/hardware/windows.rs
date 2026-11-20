//! Windows: the DXGI probe, and a parser for the capture script's whole-machine JSON so a PC can
//! be checked from any OS.

use serde::Deserialize;
use serde_json::Value;

use super::{
    CpuReport, DxgiAdapter, HardwareReport, OsKind, OsReport, ParseError, Probe, gpus_from_dxgi,
    parse_nvidia_smi, parse_nvidia_smi_compute_cap,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Capture {
    #[serde(default)]
    dxgi: Value,
    #[serde(default)]
    nvidia_smi: Value,
    cpu: Value,
    cpu_features: Value,
    memory: Value,
    os: Value,
}

/// Builds a whole report from `scripts/capture-hardware-windows.ps1`'s file. A `dxgi` or
/// `nvidiaSmi` section that failed (`{"error": ...}`, or nvidia-smi exiting non-zero) adds its
/// probe to `problems`; the other sections are required.
pub fn report_from_windows_capture(json: &str) -> Result<HardwareReport, ParseError> {
    let capture: Capture =
        serde_json::from_str(json).map_err(|e| ParseError(format!("capture JSON: {e}")))?;
    let mut problems = Vec::new();

    let adapters: Vec<DxgiAdapter> = match serde_json::from_value(capture.dxgi) {
        Ok(adapters) => adapters,
        Err(_) => {
            problems.push(Probe::Dxgi);
            Vec::new()
        }
    };
    let (smi, caps) = smi_from_capture(&capture.nvidia_smi, &mut problems);
    let gpus = gpus_from_dxgi(&adapters, &smi, &caps);

    let cpu0 = capture
        .cpu
        .get(0)
        .ok_or_else(|| ParseError("capture has no cpu entry".into()))?;
    let count = |key: &str| {
        cpu0.get(key)
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| ParseError(format!("capture cpu has no {key}")))
    };
    let cpu = CpuReport {
        name: cpu0
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| ParseError("capture cpu has no name".into()))?
            .trim()
            .to_string(),
        cores: count("numberOfCores")?,
        threads: count("numberOfLogicalProcessors")?,
        avx2: capture
            .cpu_features
            .get("avx2")
            .and_then(Value::as_bool)
            .ok_or_else(|| ParseError("capture has no cpuFeatures.avx2".into()))?,
    };
    let memory_bytes = capture
        .memory
        .get("totalPhysicalMemory")
        .and_then(Value::as_u64)
        .ok_or_else(|| ParseError("capture has no memory.totalPhysicalMemory".into()))?;
    let os_field = |key: &str| match capture.os.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(Value::Number(n)) => Ok(n.to_string()),
        _ => Err(ParseError(format!("capture os has no {key}"))),
    };
    let version = format!(
        "{} {} ({}.{})",
        os_field("caption")?.trim(),
        os_field("displayVersion")?,
        os_field("currentBuild")?,
        os_field("ubr")?
    );

    Ok(HardwareReport {
        os: OsReport {
            kind: OsKind::Windows,
            version,
            arch: "x86_64".into(),
        },
        cpu,
        memory_bytes,
        gpus,
        problems,
    })
}

/// Reads the `nvidiaSmi` section. Absent nvidia-smi (`present: false`) is not a problem; a query
/// that failed or does not parse is.
fn smi_from_capture(
    section: &Value,
    problems: &mut Vec<Probe>,
) -> (Vec<super::NvidiaSmiGpu>, Vec<(u32, String)>) {
    if section.get("present").and_then(Value::as_bool) != Some(true) {
        if section.get("error").is_some() {
            problems.push(Probe::NvidiaSmi);
        }
        return (Vec::new(), Vec::new());
    }
    let output = |key: &str| -> Option<String> {
        let query = section.get(key)?;
        if query.get("exitCode").and_then(Value::as_i64) != Some(0) {
            return None;
        }
        let lines = query.get("stdout")?.as_array()?;
        Some(
            lines
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n"),
        )
    };
    let smi = output("base").and_then(|csv| parse_nvidia_smi(&csv).ok());
    let caps = output("computeCap").and_then(|csv| parse_nvidia_smi_compute_cap(&csv).ok());
    if smi.is_none() || caps.is_none() {
        problems.push(Probe::NvidiaSmi);
    }
    (smi.unwrap_or_default(), caps.unwrap_or_default())
}

/// Only an `nvidia-smi.exe` missing from the PATH sends Aji to the copy in System32. A copy that
/// started and then failed is not run a second time from elsewhere.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(super) fn should_retry_in_system32(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}

/// DXGI, then `nvidia-smi` when an NVIDIA adapter exists. Not compiled on this development Mac.
#[cfg(target_os = "windows")]
pub(super) async fn probe() -> (Vec<super::GpuReport>, Vec<Probe>) {
    use std::path::PathBuf;

    let mut problems = Vec::new();
    let enumerated = match tokio::task::spawn_blocking(super::dxgi::enumerate).await {
        Ok(Ok(adapters)) => Ok(adapters),
        Ok(Err(e)) => Err(e.to_string()),
        Err(e) => Err(e.to_string()),
    };
    let adapters = match enumerated {
        Ok(adapters) => adapters,
        Err(e) => {
            super::record_problem(&mut problems, Probe::Dxgi, &e);
            return (Vec::new(), problems);
        }
    };
    let (mut smi, mut caps) = (Vec::new(), Vec::new());
    if adapters
        .iter()
        .any(|a| a.vendor_id == super::dxgi::VENDOR_NVIDIA)
    {
        let from_path = PathBuf::from("nvidia-smi.exe");
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let from_system = PathBuf::from(system_root)
            .join("System32")
            .join("nvidia-smi.exe");
        let mut result = super::nvidia_smi::query(&from_path).await;
        let retry = matches!(
            &result,
            Err(super::CommandError::NotRun(_, e)) if should_retry_in_system32(e)
        );
        if retry {
            result = super::nvidia_smi::query(&from_system).await;
        }
        match result {
            Ok(data) => {
                if let Some(e) = &data.caps_error {
                    super::record_problem(&mut problems, Probe::NvidiaSmi, e);
                }
                (smi, caps) = (data.gpus, data.caps);
            }
            Err(e) => super::record_problem(&mut problems, Probe::NvidiaSmi, &e),
        }
    }
    (gpus_from_dxgi(&adapters, &smi, &caps), problems)
}
