use std::path::PathBuf;

use super::*;

fn fixture(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/hardware")
        .join(path)
}

fn read(path: &str) -> String {
    std::fs::read_to_string(fixture(path)).unwrap()
}

fn adapter(
    description: &str,
    vendor_id: u32,
    device_id: u32,
    flags: u32,
    umd: Option<&str>,
) -> DxgiAdapter {
    DxgiAdapter {
        description: description.into(),
        vendor_id,
        device_id,
        dedicated_video_memory: 12_821_241_856,
        flags,
        umd_version: umd.map(str::to_string),
    }
}

fn rtx5070_and_basic_render() -> Vec<DxgiAdapter> {
    vec![
        adapter(
            "NVIDIA GeForce RTX 5070",
            0x10DE,
            0x2F04,
            0,
            Some("32.0.15.9144"),
        ),
        adapter("Microsoft Basic Render Driver", 0x1414, 0x008C, 2, None),
    ]
}

fn smi_rtx5070() -> (Vec<NvidiaSmiGpu>, Vec<(u32, String)>) {
    (
        parse_nvidia_smi(&read("nvidia-smi/rtx5070-synthetic.csv")).unwrap(),
        vec![(0, "12.0".to_string())],
    )
}

#[test]
fn macos_m5_fixture() {
    let gpus = gpus_from_system_profiler(&read("macos-m5/system_profiler.json")).unwrap();
    assert_eq!(gpus.len(), 1);
    assert_eq!(gpus[0].vendor, GpuVendor::Apple);
    assert_eq!(gpus[0].name, "Apple M5");
    assert_eq!(gpus[0].apple_gpu_cores, Some(10));
    assert_eq!(gpus[0].memory_bytes, None);
    assert!(!gpus[0].software);
}

#[test]
fn garbage_system_profiler_is_an_error() {
    assert!(gpus_from_system_profiler("not json").is_err());
    assert!(gpus_from_system_profiler("{}").is_err());
}

#[test]
fn nvidia_smi_parses() {
    let gpus = parse_nvidia_smi(&read("nvidia-smi/rtx5070-synthetic.csv")).unwrap();
    assert_eq!(
        gpus,
        vec![NvidiaSmiGpu {
            index: 0,
            name: "NVIDIA GeForce RTX 5070".into(),
            memory_mib: 12227,
            driver_version: "591.44".into(),
            device_id: 0x2F04,
        }]
    );
}

#[test]
fn nvidia_smi_ignores_extra_columns() {
    let csv = "index, name, memory.total [MiB], driver_version, pci.device_id, pci.sub_device_id\n\
               0, NVIDIA GeForce RTX 5070, 12227 MiB, 591.44, 0x2F0410DE, 0x00000000\n";
    assert_eq!(parse_nvidia_smi(csv).unwrap()[0].device_id, 0x2F04);
    let caps = parse_nvidia_smi_compute_cap("index, compute_cap\n0, 12.0\n1, 8.9\n").unwrap();
    assert_eq!(caps, vec![(0, "12.0".to_string()), (1, "8.9".to_string())]);
}

#[test]
fn nvidia_smi_failure_is_an_error() {
    let text = read("nvidia-smi/driver-failure.txt");
    assert!(parse_nvidia_smi(&text).is_err());
    assert!(parse_nvidia_smi_compute_cap(&text).is_err());
}

#[test]
fn nvidia_driver_from_umd() {
    use super::nvidia_driver_from_umd as derive;
    assert_eq!(derive("32.0.15.6094").as_deref(), Some("560.94"));
    assert_eq!(derive("32.0.15.8088").as_deref(), Some("580.88"));
    assert_eq!(derive("32.0.15.9144").as_deref(), Some("591.44"));
    assert_eq!(derive("32.0.15.710").as_deref(), Some("507.10"));
    assert_eq!(derive("10.0.26100"), None);
    assert_eq!(derive("a.b.c.d"), None);
}

#[test]
fn dxgi_with_nvidia_smi() {
    let (smi, caps) = smi_rtx5070();
    let gpus = gpus_from_dxgi(&rtx5070_and_basic_render(), &smi, &caps);
    assert_eq!(gpus.len(), 2);
    assert_eq!(gpus[0].vendor, GpuVendor::Nvidia);
    assert_eq!(gpus[0].memory_bytes, Some(12227 * 1024 * 1024));
    assert_eq!(gpus[0].compute_capability.as_deref(), Some("12.0"));
    assert_eq!(gpus[0].driver_version.as_deref(), Some("591.44"));
    assert_eq!(gpus[0].pci_device_id, Some(0x2F04));
    assert!(!gpus[0].software);
    assert!(gpus[1].software);
}

#[test]
fn dxgi_basic_render_driver_is_software() {
    let gpus = gpus_from_dxgi(&rtx5070_and_basic_render()[1..], &[], &[]);
    assert_eq!(gpus[0].vendor, GpuVendor::Microsoft);
    assert!(gpus[0].software);
    // A software flag alone also counts, whatever the vendor.
    let flagged = adapter("Some renderer", 0x1234, 1, 2, None);
    assert!(gpus_from_dxgi(&[flagged], &[], &[])[0].software);
}

#[test]
fn dxgi_vm_adapters_are_software() {
    for vendor in [0x15AD, 0x80EE, 0x1AB8, 0x1234, 0x1AF4] {
        let vm = adapter("Virtual display adapter", vendor, 0x0405, 0, None);
        let gpus = gpus_from_dxgi(&[vm], &[], &[]);
        assert_eq!(gpus.len(), 1, "{vendor:#06x}");
        assert!(gpus[0].software, "{vendor:#06x}");
    }
}

#[test]
fn sysfs_vm_cards_are_software() {
    let root = std::env::temp_dir().join(format!("aji-sysfs-vm-{}", std::process::id()));
    let device = root.join("class/drm/card0/device");
    std::fs::create_dir_all(&device).unwrap();
    std::fs::write(device.join("vendor"), "0x1af4\n").unwrap();
    std::fs::write(device.join("device"), "0x1050\n").unwrap();
    let gpus = gpus_from_sysfs(&root);
    std::fs::remove_dir_all(&root).unwrap();
    assert_eq!(gpus.len(), 1);
    assert!(gpus[0].software);
}

#[test]
fn dxgi_without_nvidia_smi_derives_the_driver() {
    let gpus = gpus_from_dxgi(&rtx5070_and_basic_render(), &[], &[]);
    assert_eq!(gpus[0].driver_version.as_deref(), Some("591.44"));
    assert_eq!(gpus[0].compute_capability, None);
    assert_eq!(gpus[0].name, "NVIDIA GeForce RTX 5070");
    assert_eq!(gpus[0].memory_bytes, Some(12_821_241_856));
}

#[test]
fn dxgi_other_vendors_keep_the_umd_version() {
    let amd = adapter("AMD Radeon", 0x1002, 0x744C, 0, Some("32.0.21001.9005"));
    let intel = adapter("Intel Graphics", 0x8086, 0x46A6, 0, Some("31.0.101.5186"));
    let gpus = gpus_from_dxgi(&[amd, intel], &[], &[]);
    assert_eq!(gpus[0].vendor, GpuVendor::Amd);
    assert_eq!(gpus[0].driver_version.as_deref(), Some("32.0.21001.9005"));
    assert_eq!(gpus[1].vendor, GpuVendor::Intel);
    assert_eq!(gpus[1].driver_version.as_deref(), Some("31.0.101.5186"));
}

#[test]
fn sysfs_synthetic() {
    let gpus = gpus_from_sysfs(&fixture("linux-synthetic/sys"));
    assert_eq!(gpus.len(), 3, "connectors and render nodes are skipped");
    assert_eq!(gpus[0].vendor, GpuVendor::Amd);
    assert_eq!(gpus[0].name, "AMD GPU 0x744c");
    assert_eq!(gpus[0].memory_bytes, Some(16 * 1024 * 1024 * 1024));
    assert_eq!(gpus[0].pci_device_id, Some(0x744C));
    assert_eq!(gpus[1].vendor, GpuVendor::Intel);
    assert_eq!(gpus[1].memory_bytes, None);
    assert_eq!(gpus[2].vendor, GpuVendor::Nvidia);
    assert_eq!(gpus[2].name, "NVIDIA GPU 0x2f04");
}

#[test]
fn sysfs_nvidia_card_is_filled_from_nvidia_smi() {
    use super::nvidia_smi::fill_from_nvidia_smi;
    let mut gpus = gpus_from_sysfs(&fixture("linux-synthetic/sys"));
    let (smi, caps) = smi_rtx5070();
    let matched = fill_from_nvidia_smi(&mut gpus, &smi, &caps);
    assert_eq!(matched, vec![false, false, true]);
    assert_eq!(gpus[2].name, "NVIDIA GeForce RTX 5070");
    assert_eq!(gpus[2].memory_bytes, Some(12227 * 1024 * 1024));
    assert_eq!(gpus[2].driver_version.as_deref(), Some("591.44"));
    assert_eq!(gpus[2].compute_capability.as_deref(), Some("12.0"));
    assert_eq!(
        gpus[0].name, "AMD GPU 0x744c",
        "other vendors are left alone"
    );
}

#[test]
fn failed_compute_cap_query_keeps_the_base_data() {
    use super::nvidia_smi::smi_from_outputs;
    let base = read("nvidia-smi/rtx5070-synthetic.csv");
    let failure = || Err(ParseError(read("nvidia-smi/driver-failure.txt")));
    let data = smi_from_outputs(&base, failure()).unwrap();
    assert_eq!(data.gpus.len(), 1);
    assert!(data.caps.is_empty());
    assert!(!data.caps_ok);
    let data = smi_from_outputs(&base, Ok("index, compute_cap\n0, 12.0\n".into())).unwrap();
    assert!(data.caps_ok);
    assert_eq!(data.caps, vec![(0, "12.0".to_string())]);
    assert!(smi_from_outputs(&read("nvidia-smi/driver-failure.txt"), Ok(String::new())).is_err());
}

#[test]
fn sysfs_missing_tree_is_empty() {
    assert!(gpus_from_sysfs(&fixture("no-such-folder")).is_empty());
}

#[test]
fn synthetic_capture_gives_the_rtx5070() {
    let report =
        report_from_windows_capture(&read("windows-synthetic/aji-hardware-capture.json")).unwrap();
    assert!(report.problems.is_empty());
    assert_eq!(report.os.kind, OsKind::Windows);
    assert_eq!(
        report.os.version,
        "Microsoft Windows 11 Pro 25H2 (26100.6584)"
    );
    assert_eq!(report.os.arch, "x86_64");
    assert_eq!(report.cpu.name, "Example CPU 8-Core Processor");
    assert_eq!(
        (report.cpu.cores, report.cpu.threads, report.cpu.avx2),
        (8, 16, true)
    );
    assert_eq!(report.memory_bytes, 34_359_738_368);
    assert_eq!(report.gpus.len(), 2);
    let nvidia = &report.gpus[0];
    assert_eq!(nvidia.vendor, GpuVendor::Nvidia);
    assert_eq!(nvidia.name, "NVIDIA GeForce RTX 5070");
    assert_eq!(nvidia.memory_bytes, Some(12227 * 1024 * 1024));
    assert_eq!(nvidia.driver_version.as_deref(), Some("591.44"));
    assert_eq!(nvidia.compute_capability.as_deref(), Some("12.0"));
    assert!(!nvidia.software);
    assert!(report.gpus[1].software);
}

#[test]
fn capture_sections_that_failed_become_problems() {
    let mut capture: serde_json::Value =
        serde_json::from_str(&read("windows-synthetic/aji-hardware-capture.json")).unwrap();
    capture["dxgi"] = serde_json::json!({"error": "no dxgi"});
    capture["nvidiaSmi"]["base"]["exitCode"] = 9.into();
    let report = report_from_windows_capture(&capture.to_string()).unwrap();
    assert_eq!(report.problems, vec![Probe::Dxgi, Probe::NvidiaSmi]);
    assert!(report.gpus.is_empty());

    capture["nvidiaSmi"] = serde_json::json!({"present": false});
    capture["dxgi"] = serde_json::from_str::<serde_json::Value>(&read(
        "windows-synthetic/aji-hardware-capture.json",
    ))
    .unwrap()["dxgi"]
        .clone();
    let report = report_from_windows_capture(&capture.to_string()).unwrap();
    assert!(report.problems.is_empty());
    assert_eq!(report.gpus[0].driver_version.as_deref(), Some("591.44"));
}

#[test]
fn current_os_matches_the_build_target() {
    #[cfg(target_os = "macos")]
    assert_eq!(OsKind::current(), OsKind::Macos);
    #[cfg(target_os = "windows")]
    assert_eq!(OsKind::current(), OsKind::Windows);
    #[cfg(target_os = "linux")]
    assert_eq!(OsKind::current(), OsKind::Linux);
}

#[tokio::test]
async fn detect_live_sanity() {
    let report = detect().await;
    assert!(report.cpu.cores >= 1);
    assert!(report.cpu.threads >= report.cpu.cores);
    assert!(report.memory_bytes > 0);
    assert_eq!(report.os.kind, OsKind::current());
}
