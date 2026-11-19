//! What the setup wizard asks for: the hardware report and the answers read from it and from the
//! manifest in use.
//!
//! Detection runs once, on first use. The manifest is read through [`ManifestStore::current`], so
//! no request waits for, or holds a lock across, a refresh in progress.

use tokio::sync::OnceCell;

use crate::hardware::{HardwareReport, detect};
use crate::manifest::{Backend, ManifestStore};
use crate::recommend::{
    BackendRecommendation, EngineVersionChoice, NetworkList, networks, recommend_backends, versions,
};

pub struct Setup {
    manifest: ManifestStore,
    hardware: OnceCell<HardwareReport>,
}

impl std::fmt::Debug for Setup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Setup").finish_non_exhaustive()
    }
}

impl Setup {
    /// Detects the hardware lazily, on the first request that needs it.
    pub fn new(manifest: ManifestStore) -> Setup {
        Setup {
            manifest,
            hardware: OnceCell::new(),
        }
    }

    /// Uses `report` instead of detecting. For tests.
    pub fn with_hardware(manifest: ManifestStore, report: HardwareReport) -> Setup {
        Setup {
            manifest,
            hardware: OnceCell::new_with(Some(report)),
        }
    }

    pub fn manifest(&self) -> &ManifestStore {
        &self.manifest
    }

    pub async fn hardware(&self) -> HardwareReport {
        self.hardware.get_or_init(detect).await.clone()
    }

    pub async fn backends(&self) -> BackendRecommendation {
        let report = self.hardware().await;
        recommend_backends(&report, &self.manifest.current().manifest)
    }

    pub async fn versions(&self, backend: Backend) -> Vec<EngineVersionChoice> {
        let report = self.hardware().await;
        versions(&report, &self.manifest.current().manifest, backend)
    }

    /// `None` when `engine` is not in the manifest.
    pub async fn networks(&self, engine: &str) -> Option<NetworkList> {
        let report = self.hardware().await;
        networks(&report, &self.manifest.current().manifest, engine)
    }
}
