//! `nvidia-smi` CSV output. Columns are found by header name and extra columns are ignored, so
//! Aji's own five-column query and the capture script's six-column one both parse.

use super::{GpuReport, GpuVendor, ParseError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NvidiaSmiGpu {
    pub index: u32,
    pub name: String,
    pub memory_mib: u64,
    pub driver_version: String,
    /// The PCI device id: the high 16 bits of `pci.device_id`.
    pub device_id: u16,
}

/// Parses `--query-gpu=index,name,memory.total,driver_version,pci.device_id --format=csv`.
pub fn parse_nvidia_smi(csv: &str) -> Result<Vec<NvidiaSmiGpu>, ParseError> {
    let (columns, rows) = table(
        csv,
        &[
            "index",
            "name",
            "memory.total",
            "driver_version",
            "pci.device_id",
        ],
    )?;
    rows.iter()
        .map(|row| {
            let field = |i: usize| row[columns[i]].as_str();
            let index = parse_index(field(0))?;
            let memory = field(2);
            let memory_mib = memory
                .strip_suffix("MiB")
                .unwrap_or(memory)
                .trim()
                .parse()
                .map_err(|_| ParseError(format!("nvidia-smi memory {memory:?}")))?;
            let id = field(4);
            let hex = id
                .strip_prefix("0x")
                .or_else(|| id.strip_prefix("0X"))
                .unwrap_or(id);
            let device_id = u32::from_str_radix(hex, 16)
                .ok()
                .filter(|_| hex.len() == 8)
                .map(|v| (v >> 16) as u16)
                .ok_or_else(|| ParseError(format!("nvidia-smi pci.device_id {id:?}")))?;
            Ok(NvidiaSmiGpu {
                index,
                name: field(1).to_string(),
                memory_mib,
                driver_version: field(3).to_string(),
                device_id,
            })
        })
        .collect()
}

/// Parses `--query-gpu=index,compute_cap --format=csv` into `(index, "12.0")` pairs.
pub fn parse_nvidia_smi_compute_cap(csv: &str) -> Result<Vec<(u32, String)>, ParseError> {
    let (columns, rows) = table(csv, &["index", "compute_cap"])?;
    rows.iter()
        .map(|row| Ok((parse_index(&row[columns[0]])?, row[columns[1]].clone())))
        .collect()
}

fn parse_index(text: &str) -> Result<u32, ParseError> {
    text.parse()
        .map_err(|_| ParseError(format!("nvidia-smi index {text:?}")))
}

/// Splits the CSV into the positions of the wanted columns and the rows. A header that lacks a
/// wanted column, or a row with the wrong number of fields, is an error: that is what
/// nvidia-smi's failure messages look like.
fn table(csv: &str, wanted: &[&str]) -> Result<(Vec<usize>, Vec<Vec<String>>), ParseError> {
    let mut lines = csv.lines().map(str::trim).filter(|l| !l.is_empty());
    let header: Vec<&str> = lines
        .next()
        .ok_or_else(|| ParseError("nvidia-smi printed nothing".into()))?
        .split(',')
        .map(|name| {
            let name = name.trim();
            name.split(" [").next().unwrap_or(name)
        })
        .collect();
    let columns = wanted
        .iter()
        .map(|name| {
            header
                .iter()
                .position(|h| h == name)
                .ok_or_else(|| ParseError(format!("nvidia-smi: no {name} column")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let rows = lines
        .map(|line| {
            let row: Vec<String> = line.split(',').map(|f| f.trim().to_string()).collect();
            if row.len() == header.len() {
                Ok(row)
            } else {
                Err(ParseError(format!("nvidia-smi line {line:?}")))
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((columns, rows))
}

/// Names the NVIDIA entries of `gpus` and fills in their memory, driver and compute capability
/// from `nvidia-smi`, matching on `pci_device_id`. Two identical cards share a device id, so each
/// smi entry is claimed once. Returns, for each GPU, whether an smi entry matched it.
pub(super) fn fill_from_nvidia_smi(
    gpus: &mut [GpuReport],
    smi: &[NvidiaSmiGpu],
    caps: &[(u32, String)],
) -> Vec<bool> {
    let mut used = vec![false; smi.len()];
    gpus.iter_mut()
        .map(|gpu| {
            if gpu.vendor != GpuVendor::Nvidia {
                return false;
            }
            let found = smi
                .iter()
                .enumerate()
                .find(|(i, s)| !used[*i] && Some(s.device_id) == gpu.pci_device_id);
            let Some((i, s)) = found else { return false };
            used[i] = true;
            gpu.name = s.name.clone();
            gpu.memory_bytes = Some(s.memory_mib * 1024 * 1024);
            gpu.driver_version = Some(s.driver_version.clone());
            gpu.compute_capability = caps
                .iter()
                .find(|(index, _)| *index == s.index)
                .map(|(_, cap)| cap.clone());
            true
        })
        .collect()
}

/// What the two nvidia-smi queries gave. The base data is kept when only the compute-capability
/// query failed (older drivers lack the field): `caps_ok` is then false.
#[cfg_attr(not(any(target_os = "windows", target_os = "linux")), allow(dead_code))]
pub(super) struct SmiData {
    pub gpus: Vec<NvidiaSmiGpu>,
    pub caps: Vec<(u32, String)>,
    pub caps_ok: bool,
}

/// Combines the outputs of the two queries. Only a failed base query is an error.
#[cfg_attr(not(any(target_os = "windows", target_os = "linux")), allow(dead_code))]
pub(super) fn smi_from_outputs(
    base: &str,
    caps: Result<String, ParseError>,
) -> Result<SmiData, ParseError> {
    let gpus = parse_nvidia_smi(base)?;
    let caps = caps.and_then(|csv| parse_nvidia_smi_compute_cap(&csv));
    Ok(SmiData {
        gpus,
        caps_ok: caps.is_ok(),
        caps: caps.unwrap_or_default(),
    })
}

/// Runs the two nvidia-smi queries.
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub(super) async fn query(program: &std::path::Path) -> Result<SmiData, ParseError> {
    let limit = std::time::Duration::from_secs(10);
    let base = super::run_command(
        program,
        &[
            "--query-gpu=index,name,memory.total,driver_version,pci.device_id",
            "--format=csv",
        ],
        limit,
    )
    .await?;
    let caps = super::run_command(
        program,
        &["--query-gpu=index,compute_cap", "--format=csv"],
        limit,
    )
    .await;
    smi_from_outputs(&base, caps)
}
