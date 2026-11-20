//! What "delete unused downloaded files" removes (M5 design 5.4): everything under the install
//! root that the active set does not use, including leftovers of interrupted jobs.

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use super::{InstallRoot, Installed};
use crate::manifest::Backend;

/// The active engine set, as the settings page names it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ActiveSummary {
    pub engine: String,
    pub version: String,
    pub backend: Backend,
    pub network: String,
    /// The network's display name: its id, or an imported file's name.
    pub network_name: String,
    pub threads: u32,
    /// The benchmark's speed at `threads`, or `None` when the count is the backend's default
    /// and was never measured.
    pub visits_per_second: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoveError {
    /// A job is running.
    Busy,
    Io(String),
}

/// The folders whose entries can be unused, relative to the root. `katago-home/`, `manifest/`
/// and `installed.json` are never touched.
const AREAS: [&str; 6] = [
    "engines",
    "runtimes",
    "networks",
    "configs",
    "staging",
    "downloads",
];

pub fn active_summary(installed: &Installed) -> Option<ActiveSummary> {
    let set = installed.active_set()?;
    let engine = installed.engines.get(&set.engine)?;
    let network = installed.networks.get(&set.network)?;
    Some(ActiveSummary {
        engine: set.engine.clone(),
        version: engine.version.clone(),
        backend: engine.backend,
        network: set.network.clone(),
        network_name: network.name.clone(),
        threads: set.threads,
        visits_per_second: set
            .benchmark
            .iter()
            .find(|s| s.threads == set.threads)
            .map(|s| s.visits_per_second),
    })
}

/// The paths the active set uses, so they are kept.
fn kept(root: &InstallRoot, installed: &Installed) -> BTreeSet<PathBuf> {
    let mut keep = BTreeSet::new();
    let Some(set) = installed.active_set() else {
        return keep;
    };
    keep.insert(root.engine_dir(&set.engine));
    if let Some(runtime) = &set.runtime {
        keep.insert(root.runtime_dir(runtime));
    }
    if let Some(network) = installed.networks.get(&set.network) {
        keep.insert(root.network_file(&network.file));
    }
    keep.insert(root.root().join(root.config_rel(&set.engine, &set.network)));
    keep.insert(
        root.root()
            .join(root.benchmark_config_rel(&set.engine, &set.network)),
    );
    keep
}

/// Every top-level entry of the areas that the active set does not use.
pub fn unused_paths(root: &InstallRoot, installed: &Installed) -> Vec<PathBuf> {
    let keep = kept(root, installed);
    let mut unused = Vec::new();
    for area in AREAS {
        let Ok(entries) = fs::read_dir(root.root().join(area)) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !keep.contains(&path) {
                unused.push(path);
            }
        }
    }
    unused.sort();
    unused
}

/// The size of a file, or of everything inside a folder. Links are not followed.
pub fn size_of(path: &Path) -> u64 {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => fs::read_dir(path)
            .map(|entries| entries.flatten().map(|e| size_of(&e.path())).sum())
            .unwrap_or(0),
        Ok(m) => m.len(),
        Err(_) => 0,
    }
}

pub fn remove_path(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// `installed` keeping only the active set and its components.
pub fn only_active(installed: &Installed) -> Installed {
    let mut kept = Installed {
        active: installed.active.clone(),
        ..Installed::default()
    };
    if let Some(set) = installed.active_set() {
        if let Some(engine) = installed.engines.get(&set.engine) {
            kept.engines.insert(set.engine.clone(), engine.clone());
        }
        if let Some(runtime) = set.runtime.as_ref()
            && let Some(recorded) = installed.runtimes.get(runtime)
        {
            kept.runtimes.insert(runtime.clone(), recorded.clone());
        }
        if let Some(network) = installed.networks.get(&set.network) {
            kept.networks.insert(set.network.clone(), network.clone());
        }
        kept.sets.push(set.clone());
    } else {
        kept.active = None;
    }
    kept
}
