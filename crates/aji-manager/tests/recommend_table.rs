//! The recommendation table: one test per row of charter 6.3, plus the version and network lists.

use aji_manager::OsKind;
use aji_manager::hardware::{CpuReport, GpuReport, GpuVendor, HardwareReport, OsReport, Probe};
use aji_manager::manifest::{Backend, Engine, Manifest, parse_manifest};
use aji_manager::recommend::{
    BackendRecommendation, RecommendationNote as Note, networks, recommend_backends, versions,
};
use semver::Version;

const TABLE: &str = include_str!("fixtures/manifest/table-v1.json");

fn manifest() -> Manifest {
    parse_manifest(TABLE.as_bytes()).unwrap()
}

fn report(kind: OsKind, arch: &str, avx2: bool, gpus: Vec<GpuReport>) -> HardwareReport {
    HardwareReport {
        os: OsReport {
            kind,
            version: String::new(),
            arch: arch.into(),
        },
        cpu: CpuReport {
            name: "cpu".into(),
            cores: 8,
            threads: 16,
            avx2,
        },
        memory_bytes: 16 << 30,
        gpus,
        problems: Vec::new(),
    }
}

fn win(gpus: Vec<GpuReport>) -> HardwareReport {
    report(OsKind::Windows, "x86_64", true, gpus)
}

fn linux(gpus: Vec<GpuReport>) -> HardwareReport {
    report(OsKind::Linux, "x86_64", true, gpus)
}

fn mac(gpus: Vec<GpuReport>) -> HardwareReport {
    report(OsKind::Macos, "aarch64", false, gpus)
}

fn gpu(vendor: GpuVendor, name: &str, memory_gib: u64) -> GpuReport {
    GpuReport {
        vendor,
        name: name.into(),
        memory_bytes: Some(memory_gib << 30),
        driver_version: None,
        pci_device_id: None,
        apple_gpu_cores: None,
        compute_capability: None,
        software: false,
    }
}

fn nvidia(name: &str, driver: Option<&str>, cc: Option<&str>) -> GpuReport {
    GpuReport {
        driver_version: driver.map(str::to_owned),
        compute_capability: cc.map(str::to_owned),
        ..gpu(GpuVendor::Nvidia, name, 8)
    }
}

fn apple(name: &str, cores: u32) -> GpuReport {
    GpuReport {
        memory_bytes: None,
        apple_gpu_cores: Some(cores),
        ..gpu(GpuVendor::Apple, name, 0)
    }
}

fn backends(r: &BackendRecommendation) -> Vec<Backend> {
    r.backends.iter().map(|c| c.backend).collect()
}

fn check(
    r: &BackendRecommendation,
    list: &[Backend],
    default: Option<Backend>,
    fallbacks: &[Backend],
    notes: &[Note],
) {
    assert_eq!(backends(r), list, "backends");
    assert_eq!(r.default, default, "default");
    assert_eq!(r.fallbacks, fallbacks, "fallbacks");
    assert_eq!(r.notes, notes, "notes");
}

use Backend::{Cuda, Directml, Eigen, Eigenavx2, Metal, Opencl, Openvino, Rocm};

fn rtx5070() -> HardwareReport {
    win(vec![nvidia(
        "NVIDIA GeForce RTX 5070",
        Some("591.44"),
        Some("12.0"),
    )])
}

fn gtx1080() -> HardwareReport {
    win(vec![nvidia(
        "NVIDIA GeForce GTX 1080",
        Some("581.29"),
        Some("6.1"),
    )])
}

fn cuda_variants(report: &HardwareReport, m: &Manifest) -> Vec<(String, String)> {
    versions(report, m, Cuda)
        .into_iter()
        .map(|v| {
            let e = m.engines.iter().find(|e| e.id == v.engine).unwrap();
            (v.version, e.variant.clone())
        })
        .collect()
}

#[test]
fn nvidia_rtx50_new_driver() {
    let m = manifest();
    let r = recommend_backends(&rtx5070(), &m);
    check(
        &r,
        &[Cuda, Directml, Opencl],
        Some(Cuda),
        &[Directml, Opencl],
        &[],
    );
    assert_eq!(
        cuda_variants(&rtx5070(), &m),
        [
            ("1.18.2".to_owned(), "cuda13.2-cudnn9.24.0".to_owned()),
            ("1.18.1".to_owned(), "cuda13.2-cudnn9.24.0".to_owned()),
        ]
    );
    assert!(r.gpu.is_some());
}

#[test]
fn nvidia_rtx50_driver_575() {
    let m = manifest();
    let h = win(vec![nvidia(
        "NVIDIA GeForce RTX 5070",
        Some("575.51"),
        Some("12.0"),
    )]);
    let r = recommend_backends(&h, &m);
    check(
        &r,
        &[Cuda, Directml, Opencl],
        Some(Cuda),
        &[Directml, Opencl],
        &[],
    );
    assert!(
        cuda_variants(&h, &m)
            .iter()
            .all(|(_, v)| v == "cuda12.8-cudnn9.8.0")
    );
}

#[test]
fn nvidia_pascal_new_driver() {
    let m = manifest();
    let r = recommend_backends(&gtx1080(), &m);
    check(
        &r,
        &[Cuda, Directml, Opencl],
        Some(Cuda),
        &[Directml, Opencl],
        &[],
    );
    let v = cuda_variants(&gtx1080(), &m);
    assert_eq!(v.len(), 2);
    assert!(v.iter().all(|(_, v)| v == "cuda12.8-cudnn9.8.0"));
}

#[test]
fn nvidia_without_nvidia_smi() {
    let m = manifest();
    let h = win(vec![nvidia(
        "NVIDIA GeForce RTX 4060",
        Some("591.44"),
        None,
    )]);
    let r = recommend_backends(&h, &m);
    check(
        &r,
        &[Cuda, Directml, Opencl],
        Some(Cuda),
        &[Directml, Opencl],
        &[],
    );
    assert!(
        cuda_variants(&h, &m)
            .iter()
            .all(|(_, v)| v == "cuda12.8-cudnn9.8.0")
    );
}

#[test]
fn nvidia_driver_too_old() {
    let m = manifest();
    let h = win(vec![nvidia(
        "NVIDIA GeForce RTX 3060",
        Some("566.03"),
        Some("8.6"),
    )]);
    let r = recommend_backends(&h, &m);
    check(
        &r,
        &[Directml, Opencl],
        Some(Directml),
        &[Opencl],
        &[Note::DriverTooOldForCuda],
    );
    assert!(versions(&h, &m, Cuda).is_empty());
}

#[test]
fn nvidia_driver_unknown_is_too_old() {
    let h = win(vec![nvidia("NVIDIA GeForce RTX 3060", None, None)]);
    let r = recommend_backends(&h, &manifest());
    check(
        &r,
        &[Directml, Opencl],
        Some(Directml),
        &[Opencl],
        &[Note::DriverTooOldForCuda],
    );
}

#[test]
fn driver_versions_compare_as_numbers_not_strings() {
    // "1000.1" sorts before "580.00" as a string, and "572.9" after "572.61".
    let m = manifest();
    let h = win(vec![nvidia(
        "NVIDIA GeForce RTX 5070",
        Some("1000.1"),
        Some("12.0"),
    )]);
    assert_eq!(recommend_backends(&h, &m).default, Some(Cuda));
    assert!(
        cuda_variants(&h, &m)
            .iter()
            .all(|(_, v)| v == "cuda13.2-cudnn9.24.0")
    );
    let h = win(vec![nvidia(
        "NVIDIA GeForce RTX 5070",
        Some("572.9"),
        Some("12.0"),
    )]);
    assert_eq!(recommend_backends(&h, &m).default, Some(Directml));
}

#[test]
fn tags_follow_the_table() {
    use aji_manager::recommend::BackendTag::*;
    let r = recommend_backends(&rtx5070(), &manifest());
    let tags: Vec<_> = r.backends.iter().map(|c| c.tags.clone()).collect();
    assert_eq!(
        tags,
        [
            vec![Fastest],
            vec![NoRuntimeDownload],
            vec![MostCompatible, Slowest]
        ]
    );
    let r = recommend_backends(&linux(vec![]), &manifest());
    let tags: Vec<_> = r.backends.iter().map(|c| c.tags.clone()).collect();
    assert_eq!(tags, [vec![CpuOnly], vec![CpuOnly]]);
    let r = recommend_backends(&mac(vec![apple("Apple M5", 10)]), &manifest());
    assert_eq!(r.backends[0].tags, []);
    let json = serde_json::to_value(&rtx5070_choices()[1]).unwrap();
    assert_eq!(json["tags"][0], "noRuntimeDownload");
}

fn rtx5070_choices() -> Vec<aji_manager::recommend::BackendChoice> {
    recommend_backends(&rtx5070(), &manifest()).backends
}

#[test]
fn amd_rdna3() {
    let m = manifest();
    let h = win(vec![gpu(GpuVendor::Amd, "AMD Radeon RX 7800 XT", 16)]);
    let r = recommend_backends(&h, &m);
    check(
        &r,
        &[Rocm, Directml, Opencl],
        Some(Rocm),
        &[Directml, Opencl],
        &[],
    );
    let v = versions(&h, &m, Rocm);
    assert_eq!(v.len(), 1);
    let e = m.engines.iter().find(|e| e.id == v[0].engine).unwrap();
    assert_eq!(e.gpu_family.as_deref(), Some("gfx110X"));
    assert_eq!(
        r.backends[0].tags,
        [aji_manager::recommend::BackendTag::Fastest]
    );
}

#[test]
fn amd_families_by_name() {
    let m = manifest();
    for (name, family) in [
        ("AMD Radeon RX 6700 XT", "gfx103X"),
        ("AMD Radeon RX 9070", "gfx120X"),
        ("AMD Radeon 8060S Graphics", "gfx1151"),
        ("amd radeon rx 7600", "gfx110X"),
    ] {
        let h = win(vec![gpu(GpuVendor::Amd, name, 8)]);
        let v = versions(&h, &m, Rocm);
        let e = m.engines.iter().find(|e| e.id == v[0].engine).unwrap();
        assert_eq!(e.gpu_family.as_deref(), Some(family), "{name}");
    }
}

#[test]
fn amd_unknown_family() {
    let h = win(vec![gpu(GpuVendor::Amd, "AMD Radeon(TM) Graphics", 2)]);
    let r = recommend_backends(&h, &manifest());
    check(
        &r,
        &[Directml, Opencl],
        Some(Directml),
        &[Opencl],
        &[Note::UnknownAmdFamily],
    );
}

#[test]
fn intel_arc() {
    let h = win(vec![gpu(
        GpuVendor::Intel,
        "Intel(R) Arc(TM) A770 Graphics",
        16,
    )]);
    let r = recommend_backends(&h, &manifest());
    check(
        &r,
        &[Openvino, Directml, Opencl],
        Some(Openvino),
        &[Directml, Opencl],
        &[],
    );
}

#[test]
fn linux_amd() {
    let h = linux(vec![gpu(GpuVendor::Amd, "AMD Radeon RX 7800 XT", 16)]);
    let r = recommend_backends(&h, &manifest());
    check(
        &r,
        &[Opencl, Eigenavx2, Eigen],
        Some(Opencl),
        &[Eigenavx2],
        &[],
    );
    assert_eq!(r.platform, Some(aji_manager::manifest::Platform::LinuxX64));
}

#[test]
fn linux_without_avx2_falls_back_to_eigen() {
    let h = report(
        OsKind::Linux,
        "x86_64",
        false,
        vec![gpu(GpuVendor::Nvidia, "NVIDIA GeForce RTX 3060", 12)],
    );
    let r = recommend_backends(&h, &manifest());
    check(&r, &[Opencl, Eigen], Some(Opencl), &[Eigen], &[]);
}

#[test]
fn apple_m5() {
    let h = mac(vec![apple("Apple M5", 10)]);
    let r = recommend_backends(&h, &manifest());
    check(&r, &[Metal], Some(Metal), &[], &[]);
}

#[test]
fn apple_unknown_newer_chip() {
    let h = mac(vec![apple("Apple M9 Ultra", 80)]);
    let r = recommend_backends(&h, &manifest());
    check(&r, &[Metal], Some(Metal), &[], &[]);
}

#[test]
fn apple_with_a_failed_probe_still_gets_metal() {
    let mut h = mac(vec![]);
    h.problems = vec![Probe::SystemProfiler];
    let r = recommend_backends(&h, &manifest());
    check(&r, &[Metal], Some(Metal), &[], &[]);
    assert!(r.gpu.is_none());
}

#[test]
fn no_gpu_avx2() {
    let r = recommend_backends(&win(vec![]), &manifest());
    check(
        &r,
        &[Eigenavx2, Eigen],
        Some(Eigenavx2),
        &[Eigen],
        &[Note::NoUsableGpu],
    );
    assert!(r.gpu.is_none());
}

#[test]
fn no_gpu_without_avx2() {
    let h = report(OsKind::Windows, "x86_64", false, vec![]);
    let r = recommend_backends(&h, &manifest());
    check(&r, &[Eigen], Some(Eigen), &[], &[Note::NoUsableGpu]);
}

#[test]
fn basic_render_driver_counts_as_no_gpu() {
    let mut basic = gpu(GpuVendor::Microsoft, "Microsoft Basic Render Driver", 0);
    basic.software = true;
    let r = recommend_backends(&win(vec![basic]), &manifest());
    check(
        &r,
        &[Eigenavx2, Eigen],
        Some(Eigenavx2),
        &[Eigen],
        &[Note::NoUsableGpu],
    );
    assert!(r.gpu.is_none());
}

#[test]
fn a_virtualbox_adapter_counts_as_no_gpu() {
    // What the Windows probe reports for a VirtualBox guest: vendor 0x80EE, no software flag.
    let mut vbox = gpu(GpuVendor::Other, "VirtualBox Graphics Adapter", 0);
    vbox.software = true;
    let r = recommend_backends(&win(vec![vbox]), &manifest());
    check(
        &r,
        &[Eigenavx2, Eigen],
        Some(Eigenavx2),
        &[Eigen],
        &[Note::NoUsableGpu],
    );
    assert!(r.gpu.is_none());
}

#[test]
fn laptop_with_integrated_gpu_listed_first() {
    let h = win(vec![
        gpu(GpuVendor::Intel, "Intel(R) UHD Graphics 770", 1),
        nvidia(
            "NVIDIA GeForce RTX 4060 Laptop GPU",
            Some("591.44"),
            Some("8.9"),
        ),
    ]);
    let r = recommend_backends(&h, &manifest());
    check(
        &r,
        &[Cuda, Directml, Opencl],
        Some(Cuda),
        &[Directml, Opencl],
        &[],
    );
    assert_eq!(r.gpu.unwrap().vendor, GpuVendor::Nvidia);
}

#[test]
fn the_largest_gpu_of_a_vendor_wins() {
    let h = win(vec![
        gpu(GpuVendor::Amd, "AMD Radeon RX 6400", 4),
        gpu(GpuVendor::Amd, "AMD Radeon RX 7900 XTX", 24),
    ]);
    assert_eq!(
        recommend_backends(&h, &manifest())
            .gpu
            .unwrap()
            .memory_bytes,
        Some(24 << 30)
    );
}

#[test]
fn intel_mac() {
    let h = report(OsKind::Macos, "x86_64", true, vec![]);
    let r = recommend_backends(&h, &manifest());
    check(&r, &[], None, &[], &[Note::UnsupportedPlatform]);
    assert_eq!(r.platform, None);
}

#[test]
fn manifest_without_metal() {
    let mut m = manifest();
    m.engines.retain(|e| e.backend != Metal);
    let r = recommend_backends(&mac(vec![apple("Apple M5", 10)]), &m);
    check(&r, &[], None, &[], &[Note::NoEngineForBackend]);
}

#[test]
fn a_missing_engine_moves_the_next_backend_up() {
    let mut m = manifest();
    m.engines.retain(|e| e.backend != Cuda);
    let r = recommend_backends(&rtx5070(), &m);
    check(
        &r,
        &[Directml, Opencl],
        Some(Directml),
        &[Opencl],
        &[Note::NoEngineForBackend],
    );
}

#[test]
fn a_failed_gpu_probe_still_recommends_the_cpu() {
    let mut h = win(vec![]);
    h.problems = vec![Probe::Dxgi];
    let r = recommend_backends(&h, &manifest());
    assert_eq!(r.default, Some(Eigenavx2));
}

#[test]
fn runtime_bytes_is_the_whole_archives() {
    let m = manifest();
    let v = versions(&rtx5070(), &m, Cuda);
    assert_eq!(v[0].runtime_bytes, Some(1950349675));
    let v = versions(&gtx1080(), &m, Cuda);
    assert_eq!(v[0].runtime_bytes, Some(1544599496));
    assert_eq!(v[0].download_bytes, 9725374);
    let v = versions(&rtx5070(), &m, Directml);
    assert_eq!(v[0].runtime_bytes, None);
}

#[test]
fn versions_are_newest_first_and_only_the_newest_is_latest() {
    let v = versions(&rtx5070(), &manifest(), Cuda);
    assert_eq!(
        v.iter()
            .map(|v| (v.version.as_str(), v.latest))
            .collect::<Vec<_>>(),
        [("1.18.2", true), ("1.18.1", false)]
    );
    assert_eq!(v[0].released, "2026-08-30");
}

#[test]
fn versions_of_an_unlisted_backend_are_empty() {
    assert!(versions(&rtx5070(), &manifest(), Metal).is_empty());
    assert!(versions(&rtx5070(), &manifest(), Rocm).is_empty());
}

// Networks.

fn engine_with_version(m: &mut Manifest, version: &str) -> String {
    let mut e: Engine = m
        .engines
        .iter()
        .find(|e| e.backend == Eigen)
        .unwrap()
        .clone();
    e.id = format!("old-{version}");
    e.version = Version::parse(version).unwrap();
    let id = e.id.clone();
    m.engines.push(e);
    id
}

fn engine_id(m: &Manifest, report: &HardwareReport, backend: Backend) -> String {
    versions(report, m, backend)[0].engine.clone()
}

#[test]
fn networks_are_in_elo_order_and_filtered_by_version() {
    let mut m = manifest();
    let old = engine_with_version(&mut m, "1.16.0");
    let list = networks(&win(vec![]), &m, &old).unwrap();
    assert!(list.networks.iter().all(|n| !n.family.starts_with("tf")));
    assert_eq!(list.networks.len(), 5);
    let elos: Vec<_> = list.networks.iter().map(|n| n.elo.unwrap()).collect();
    assert!(elos.windows(2).all(|w| w[0] >= w[1]));

    let new = engine_id(&m, &rtx5070(), Cuda);
    let list = networks(&rtx5070(), &m, &new).unwrap();
    assert_eq!(list.networks.len(), 8);
    assert!(
        list.networks
            .iter()
            .all(|n| n.family != "b18c384nbt-humanv0")
    );
    assert_eq!(list.networks[0].size_bytes, 262041254);
}

#[test]
fn the_human_network_is_listed_apart() {
    let m = manifest();
    let id = engine_id(&m, &rtx5070(), Cuda);
    let list = networks(&rtx5070(), &m, &id).unwrap();
    let human = list.human.unwrap();
    assert_eq!(human.network, "b18c384nbt-humanv0");
    assert_eq!(human.elo, None);
    assert_eq!(human.size_bytes, 99066230);
}

#[test]
fn unknown_engine_gives_none() {
    assert!(networks(&rtx5070(), &manifest(), "nope").is_none());
}

#[test]
fn preselects_the_top_row() {
    let m = manifest();
    for (h, backend) in [
        (mac(vec![apple("Apple M5", 10)]), Metal),
        (rtx5070(), Cuda),
        (win(vec![]), Eigenavx2),
    ] {
        let id = engine_id(&m, &h, backend);
        let list = networks(&h, &m, &id).unwrap();
        assert_eq!(
            list.preselected.as_deref(),
            Some("kata1-tf3-b11c768-s12382M-d6533M")
        );
        assert_eq!(list.preselected, Some(list.networks[0].network.clone()));
    }
}

#[test]
fn preselect_follows_elo_not_architecture() {
    let mut m = manifest();
    for n in &mut m.networks {
        if n.id == "kata1-b28c512nbt-s13255194368-d5935380940" {
            n.elo = Some(15000.0);
        }
    }
    let id = engine_id(&m, &rtx5070(), Cuda);
    let list = networks(&rtx5070(), &m, &id).unwrap();
    assert_eq!(
        list.networks[0].network,
        "kata1-b28c512nbt-s13255194368-d5935380940"
    );
    assert_eq!(list.preselected, Some(list.networks[0].network.clone()));
}

#[test]
fn preselect_skips_networks_the_engine_cannot_load() {
    let mut m = manifest();
    let old = engine_with_version(&mut m, "1.16.0");
    let list = networks(&win(vec![]), &m, &old).unwrap();
    assert_eq!(
        list.preselected.as_deref(),
        Some("kata1-zhizi-b40c768nbt-s11272M-d5935M")
    );
}

#[test]
fn a_network_without_elo_sorts_last() {
    let mut m = manifest();
    m.networks[0].elo = None;
    let id = engine_id(&m, &rtx5070(), Cuda);
    let list = networks(&rtx5070(), &m, &id).unwrap();
    assert_eq!(list.networks.last().unwrap().network, m.networks[0].id);
    assert_ne!(list.preselected.as_deref(), Some(m.networks[0].id.as_str()));
}
