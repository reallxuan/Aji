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

/// The paths every recorded set uses, so they are kept. An own-files profile keeps the top-level
/// entry of each area its files sit in (Aji's KataGo or a downloaded network, say); its files
/// outside the areas are the user's and never touched anyway.
fn kept(root: &InstallRoot, installed: &Installed) -> BTreeSet<PathBuf> {
    let mut keep = BTreeSet::new();
    for own in &installed.own {
        for file in [&own.katago, &own.model, &own.config] {
            for area in AREAS {
                let area = root.root().join(area);
                if let Ok(inside) = file.strip_prefix(&area)
                    && let Some(top) = inside.components().next()
                {
                    keep.insert(area.join(top));
                }
            }
        }
    }
    for set in &installed.sets {
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
    }
    keep
}

/// Every top-level entry of the areas that no recorded set uses.
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

/// `installed` keeping every set and profile, and only the components a set names.
pub fn only_used(installed: &Installed) -> Installed {
    let mut used = Installed {
        sets: installed.sets.clone(),
        active: installed.active.clone(),
        own: installed.own.clone(),
        current: installed.current.clone(),
        ..Installed::default()
    };
    for set in &installed.sets {
        if let Some(engine) = installed.engines.get(&set.engine) {
            used.engines.insert(set.engine.clone(), engine.clone());
        }
        if let Some(runtime) = set.runtime.as_ref()
            && let Some(recorded) = installed.runtimes.get(runtime)
        {
            used.runtimes.insert(runtime.clone(), recorded.clone());
        }
        if let Some(network) = installed.networks.get(&set.network) {
            used.networks.insert(set.network.clone(), network.clone());
        }
    }
    used
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::install::{EngineSet, InstalledEngine, InstalledNetwork, OwnProfile, ProfileKey};
    use crate::manifest::Backend;

    fn set(engine: &str, network: &str) -> EngineSet {
        EngineSet {
            engine: engine.into(),
            network: network.into(),
            runtime: None,
            config: format!("configs/{engine}+{network}.cfg"),
            threads: 4,
            benchmark: Vec::new(),
            name: None,
        }
    }

    /// One engine and two networks on disk, each in a set.
    fn two_sets(dir: &Path) -> (InstallRoot, Installed) {
        let root = InstallRoot::new(dir.to_path_buf());
        let mut installed = Installed::default();
        installed.engines.insert(
            "e".into(),
            InstalledEngine {
                backend: Backend::Eigenavx2,
                version: "1.16.4".into(),
                binary: "katago".into(),
            },
        );
        for n in ["n", "m"] {
            installed.networks.insert(
                n.into(),
                InstalledNetwork {
                    file: format!("{n}.bin.gz"),
                    name: n.into(),
                    imported: false,
                },
            );
            fs::create_dir_all(root.root().join("networks")).unwrap();
            fs::write(root.network_file(&format!("{n}.bin.gz")), b"net").unwrap();
            installed.put_set(set("e", n));
        }
        fs::create_dir_all(root.engine_dir("e")).unwrap();
        installed.set_current(ProfileKey::Set {
            engine: "e".into(),
            network: "n".into(),
        });
        (root, installed)
    }

    #[test]
    fn every_set_keeps_its_files() {
        let dir = tempfile::tempdir().unwrap();
        let (root, installed) = two_sets(dir.path());
        assert_eq!(unused_paths(&root, &installed), Vec::<PathBuf>::new());
        assert_eq!(only_used(&installed), installed);
    }

    #[test]
    fn a_network_no_set_names_is_unused() {
        let dir = tempfile::tempdir().unwrap();
        let (root, mut installed) = two_sets(dir.path());
        installed.sets.retain(|s| s.network != "m");
        assert_eq!(
            unused_paths(&root, &installed),
            [root.network_file("m.bin.gz")]
        );
        let used = only_used(&installed);
        assert!(used.networks.contains_key("n") && !used.networks.contains_key("m"));
        assert!(used.engines.contains_key("e"));
        assert_eq!(used.current_key(), installed.current_key());
    }

    #[test]
    fn own_profiles_are_never_unused_and_keep_what_they_use_inside_aji() {
        let dir = tempfile::tempdir().unwrap();
        let (root, mut installed) = two_sets(dir.path());
        installed.sets.retain(|s| s.network != "m");
        assert_eq!(
            unused_paths(&root, &installed),
            [root.network_file("m.bin.gz")]
        );
        // An own profile running Aji's KataGo with a downloaded network keeps that network, even
        // once no set names it: removing it would break the profile.
        installed.own.push(OwnProfile {
            id: "own-1".into(),
            name: "inside".into(),
            katago: root.engine_dir("e").join("katago"),
            model: root.network_file("m.bin.gz"),
            config: dir.path().join("own.cfg"),
        });
        assert_eq!(unused_paths(&root, &installed), Vec::<PathBuf>::new());
        assert_eq!(only_used(&installed).own, installed.own);
    }
}
