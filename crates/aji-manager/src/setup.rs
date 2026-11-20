//! What the setup wizard asks for: the hardware report and the answers read from it and from the
//! manifest in use.
//!
//! Detection runs on first use and again on [`Setup::refresh`]. The manifest is read through [`ManifestStore::current`], so
//! no request waits for, or holds a lock across, a refresh in progress.

use std::sync::Arc;

use tokio::sync::RwLock;

use crate::hardware::{HardwareReport, detect};
use crate::manifest::{Backend, ManifestStore};
use crate::recommend::{
    BackendRecommendation, EngineVersionChoice, NetworkList, networks, recommend_backends, versions,
};

/// Produces a hardware report. Tests pass a closure; the app uses [`detect`].
pub type Detector = Arc<dyn Fn() -> HardwareReport + Send + Sync>;

pub struct Setup {
    manifest: ManifestStore,
    /// The last report, once detection has run.
    hardware: RwLock<Option<HardwareReport>>,
    /// `None` for the system's own detection.
    detector: Option<Detector>,
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
            hardware: RwLock::new(None),
            detector: None,
        }
    }

    /// Uses `report` instead of detecting, every time. For tests.
    pub fn with_hardware(manifest: ManifestStore, report: HardwareReport) -> Setup {
        Setup::with_detector(manifest, Arc::new(move || report.clone()))
    }

    /// Detects by calling `detector` instead of probing the system. For tests.
    pub fn with_detector(manifest: ManifestStore, detector: Detector) -> Setup {
        Setup {
            manifest,
            hardware: RwLock::new(None),
            detector: Some(detector),
        }
    }

    pub fn manifest(&self) -> &ManifestStore {
        &self.manifest
    }

    /// The report, detecting on the first call.
    pub async fn hardware(&self) -> HardwareReport {
        if let Some(report) = self.hardware.read().await.as_ref() {
            return report.clone();
        }
        let mut slot = self.hardware.write().await;
        if let Some(report) = slot.as_ref() {
            return report.clone();
        }
        let report = self.detect().await;
        *slot = Some(report.clone());
        report
    }

    /// Detects again and keeps the new report, for example after a driver update.
    pub async fn refresh(&self) -> HardwareReport {
        let mut slot = self.hardware.write().await;
        let report = self.detect().await;
        *slot = Some(report.clone());
        report
    }

    async fn detect(&self) -> HardwareReport {
        match &self.detector {
            Some(detector) => detector(),
            None => detect().await,
        }
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
