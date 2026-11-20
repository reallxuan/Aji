//! Fixtures the unit tests share: synthetic hardware reports, an engine with no KataGo, and an
//! installer that never downloads.

use std::path::Path;
use std::sync::Arc;

use aji_core::{BoardSize, Komi, Position, Rules};
use aji_engine::{Engine, EngineOptions};
use aji_manager::Setup;
use aji_manager::hardware::{CpuReport, GpuReport, GpuVendor, HardwareReport, OsReport};
use aji_manager::install::{
    DownloadSource, FreeSpace, InstallOptions, InstallRoot, Installer, InstallerParts,
};
use aji_manager::manifest::{BUNDLED, ClientOptions, ManifestStore, Platform, http_client};
use tokio::sync::watch;

use crate::protocol::OsKind;

pub fn unconfigured() -> Engine {
    let position = Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap());
    Engine::spawn(None, position, EngineOptions::default(), |_| {})
}

pub fn apple_m5() -> HardwareReport {
    HardwareReport {
        os: OsReport {
            kind: OsKind::Macos,
            version: "27.2".into(),
            arch: "aarch64".into(),
        },
        cpu: CpuReport {
            name: "Apple M5".into(),
            cores: 10,
            threads: 10,
            avx2: false,
        },
        memory_bytes: 25_769_803_776,
        gpus: vec![GpuReport {
            vendor: GpuVendor::Apple,
            name: "Apple M5".into(),
            memory_bytes: None,
            driver_version: None,
            pci_device_id: None,
            apple_gpu_cores: Some(10),
            compute_capability: None,
            software: false,
        }],
        problems: Vec::new(),
    }
}

/// The bundled manifest, never refreshed, answering for `report`.
pub fn setup(report: HardwareReport) -> Arc<Setup> {
    // The cache folder does not exist and the store is never refreshed, so the bundled
    // manifest is in use.
    let store = ManifestStore::open(BUNDLED, "no-such-manifest-cache".into(), Vec::new());
    Arc::new(Setup::with_hardware(store, report))
}

/// Every disk reports no free space, so a job that starts against the bundled manifest fails
/// its space check before it fetches anything.
pub struct NoSpace;

impl FreeSpace for NoSpace {
    fn available(&self, _: &Path) -> std::io::Result<u64> {
        Ok(0)
    }
}

/// An installer rooted at `root` whose jobs never download. Must run on a Tokio runtime.
pub fn installer(
    root: &Path,
    setup: Arc<Setup>,
    engine: Engine,
    source: watch::Receiver<DownloadSource>,
) -> Arc<Installer> {
    Installer::new(
        InstallerParts {
            root: InstallRoot::new(root.to_path_buf()),
            setup,
            engine,
            client: http_client("Aji/test", ClientOptions::default()).unwrap(),
            source,
            space: Arc::new(NoSpace),
            options: InstallOptions::default(),
            // The service tests install the bundled manifest's Windows CUDA engine.
            platform: Some(Platform::WindowsX64),
        },
        |_| {},
    )
}
