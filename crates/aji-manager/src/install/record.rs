//! `installed.json`: the verified components and the usable engine sets (design 5.9).

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use aji_engine::EngineFiles;
use serde::{Deserialize, Serialize};

use super::InstallRoot;
use crate::atomic::write_atomically;
use crate::manifest::{Backend, is_plain_name};

/// The record's format. A newer one is kept aside, not read.
pub const RECORD_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub schema: u32,
    /// Verified engine packages, by manifest id.
    pub engines: BTreeMap<String, InstalledEngine>,
    /// Verified runtime sets, by manifest id.
    pub runtimes: BTreeMap<String, InstalledRuntime>,
    /// Verified networks, by manifest id (or `imported-<hash>`).
    pub networks: BTreeMap<String, InstalledNetwork>,
    /// Engine sets whose test query passed.
    pub sets: Vec<EngineSet>,
    pub active: Option<SetKey>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEngine {
    pub backend: Backend,
    pub version: String,
    /// The KataGo program's file name inside `engines/<id>`.
    pub binary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntime {
    /// The archive file names it was unpacked from.
    pub archives: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledNetwork {
    /// The file name inside `networks/`.
    pub file: String,
    /// The name shown to the user.
    pub name: String,
    pub imported: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSpeed {
    pub threads: u32,
    pub visits_per_second: f64,
}

/// An engine, its runtime and a network that passed the test query together.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineSet {
    pub engine: String,
    pub network: String,
    pub runtime: Option<String>,
    /// The analysis config, relative to the root, with `/` separators.
    pub config: String,
    pub threads: u32,
    pub benchmark: Vec<ThreadSpeed>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetKey {
    pub engine: String,
    pub network: String,
}

impl Default for Installed {
    fn default() -> Self {
        Installed {
            schema: RECORD_SCHEMA,
            engines: BTreeMap::new(),
            runtimes: BTreeMap::new(),
            networks: BTreeMap::new(),
            sets: Vec::new(),
            active: None,
        }
    }
}

impl EngineSet {
    pub fn key(&self) -> SetKey {
        SetKey {
            engine: self.engine.clone(),
            network: self.network.clone(),
        }
    }
}

impl Installed {
    /// Adds `set`, replacing the set with the same engine and network.
    pub fn put_set(&mut self, set: EngineSet) {
        match self
            .sets
            .iter_mut()
            .find(|s| s.engine == set.engine && s.network == set.network)
        {
            Some(existing) => *existing = set,
            None => self.sets.push(set),
        }
    }

    /// The set `active` names, if it is recorded.
    pub fn active_set(&self) -> Option<&EngineSet> {
        let key = self.active.as_ref()?;
        self.sets
            .iter()
            .find(|s| s.engine == key.engine && s.network == key.network)
    }
}

/// Reads the record. A missing file gives an empty record. A malformed one, a newer schema,
/// or one naming a path that is not a plain name, is renamed to `installed.json.bad-<unix
/// seconds>` and logged, and an empty record is returned: nothing is silently overwritten.
/// A record that exists but cannot be read is logged and gives an empty record too; it is left
/// in place, and [`update_installed`] refuses to write over it.
pub fn load_installed(path: &Path) -> Installed {
    read_installed(path).unwrap_or_else(|e| {
        eprintln!("aji: cannot read {}: {e}", path.display());
        Installed::default()
    })
}

/// [`load_installed`], except that a record that exists but cannot be read is an error.
pub(super) fn read_installed(path: &Path) -> io::Result<Installed> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Installed::default()),
        Err(e) => return Err(e),
    };
    Ok(match parse_installed(&bytes) {
        Ok(installed) => installed,
        Err(why) => {
            keep_aside(path, &why);
            Installed::default()
        }
    })
}

fn parse_installed(bytes: &[u8]) -> Result<Installed, String> {
    #[derive(Deserialize)]
    struct Head {
        schema: u32,
    }
    let head: Head = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if head.schema != RECORD_SCHEMA {
        return Err(format!("schema {} is not {RECORD_SCHEMA}", head.schema));
    }
    let installed: Installed = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    check_names(&installed)?;
    Ok(installed)
}

/// Every id and file name becomes part of a path under the root, so each must be a plain name.
fn check_names(installed: &Installed) -> Result<(), String> {
    let plain = |what: &str, name: &str| {
        if is_plain_name(name) {
            Ok(())
        } else {
            Err(format!("{what} {name:?} is not a plain name"))
        }
    };
    for (id, engine) in &installed.engines {
        plain("engine", id)?;
        plain("engine binary", &engine.binary)?;
    }
    for (id, runtime) in &installed.runtimes {
        plain("runtime", id)?;
        for archive in &runtime.archives {
            plain("runtime archive", archive)?;
        }
    }
    for (id, network) in &installed.networks {
        plain("network", id)?;
        plain("network file", &network.file)?;
    }
    for set in &installed.sets {
        plain("set engine", &set.engine)?;
        plain("set network", &set.network)?;
        if let Some(runtime) = &set.runtime {
            plain("set runtime", runtime)?;
        }
        for part in set.config.split('/') {
            plain("set config", part)?;
        }
    }
    if let Some(active) = &installed.active {
        plain("active engine", &active.engine)?;
        plain("active network", &active.network)?;
    }
    Ok(())
}

/// Renames an unusable record to `<name>.bad-<unix seconds>` so that it is never overwritten.
fn keep_aside(path: &Path, why: &str) {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let mut aside = path.with_file_name(format!("{name}.bad-{secs}"));
    let mut n = 1;
    while aside.exists() {
        aside = path.with_file_name(format!("{name}.bad-{secs}-{n}"));
        n += 1;
    }
    match fs::rename(path, &aside) {
        Ok(()) => eprintln!(
            "aji: {} is not usable ({why}); kept as {}",
            path.display(),
            aside.display()
        ),
        Err(e) => eprintln!(
            "aji: {} is not usable ({why}) and could not be kept aside: {e}",
            path.display()
        ),
    }
}

/// Loads the record, applies `change` and saves it. The caller serialises record writes. A
/// record that exists but cannot be read (a sharing violation, a permission) is an error, so
/// an empty record never replaces it; an unusable one has been kept aside and starts empty.
pub fn update_installed(path: &Path, change: impl FnOnce(&mut Installed)) -> io::Result<Installed> {
    let mut record = read_installed(path)?;
    change(&mut record);
    save_installed(path, &record)?;
    Ok(record)
}

/// Writes the record through a unique temporary file that is then renamed over it.
pub fn save_installed(path: &Path, installed: &Installed) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec_pretty(installed).map_err(io::Error::other)?;
    write_atomically(path, &bytes)
}

/// The files to run `set` with: KataGo absolute; the config and the model relative to the
/// root, which is the working directory; the runtime folder first on `PATH`. `None` when the
/// set names a component that is not recorded.
pub fn engine_files(
    root: &InstallRoot,
    installed: &Installed,
    set: &EngineSet,
) -> Option<EngineFiles> {
    let engine = installed.engines.get(&set.engine)?;
    let network = installed.networks.get(&set.network)?;
    let path_prepend = match &set.runtime {
        Some(runtime) => {
            installed.runtimes.get(runtime)?;
            vec![root.runtime_dir(runtime)]
        }
        None => Vec::new(),
    };
    Some(EngineFiles {
        katago: root.engine_dir(&set.engine).join(&engine.binary),
        model: Path::new("networks").join(&network.file),
        config: set.config.split('/').collect::<PathBuf>(),
        working_dir: root.root().to_path_buf(),
        path_prepend,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    fn set(engine: &str, network: &str, threads: u32) -> EngineSet {
        EngineSet {
            engine: engine.into(),
            network: network.into(),
            runtime: None,
            config: format!("configs/{engine}+{network}.cfg"),
            threads,
            benchmark: vec![ThreadSpeed {
                threads,
                visits_per_second: 123.5,
            }],
        }
    }

    fn sample() -> Installed {
        let mut installed = Installed::default();
        installed.engines.insert(
            "e".into(),
            InstalledEngine {
                backend: Backend::Cuda,
                version: "1.18.2".into(),
                binary: "katago.exe".into(),
            },
        );
        installed.runtimes.insert(
            "r".into(),
            InstalledRuntime {
                archives: vec!["cudnn.zip".into()],
            },
        );
        installed.networks.insert(
            "n".into(),
            InstalledNetwork {
                file: "n.bin.gz".into(),
                name: "kata1-n".into(),
                imported: false,
            },
        );
        installed.put_set(set("e", "n", 16));
        installed.active = Some(SetKey {
            engine: "e".into(),
            network: "n".into(),
        });
        installed
    }

    fn bad_files(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("installed.json.bad-"))
            .collect()
    }

    /// Makes `path` unreadable, or returns `false` where that is not possible (root ignores
    /// file modes).
    #[cfg(unix)]
    fn make_unreadable(path: &Path) -> bool {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o000)).unwrap();
        std::fs::read(path).is_err()
    }

    #[cfg(unix)]
    fn make_readable(path: &Path) {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644)).unwrap();
    }

    /// A record that exists but cannot be read is not replaced by an empty one: the change
    /// fails and the record keeps every set.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_record_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installed.json");
        save_installed(&path, &sample()).unwrap();
        if !make_unreadable(&path) {
            return;
        }
        let result = update_installed(&path, |record| record.active = None);
        make_readable(&path);
        assert!(result.is_err(), "{result:?}");
        assert_eq!(load_installed(&path), sample());
    }

    /// The reviewer's reproduction: importing a network while the record cannot be read.
    #[cfg(unix)]
    #[test]
    fn an_import_does_not_erase_an_unreadable_record() {
        let dir = tempfile::tempdir().unwrap();
        let root = InstallRoot::new(dir.path().join("aji"));
        let path = root.record_file();
        save_installed(&path, &sample()).unwrap();
        let network = dir.path().join("net.bin.gz");
        std::fs::write(&network, [0x1f, 0x8b, 8, 0]).unwrap();
        if !make_unreadable(&path) {
            return;
        }
        let result = crate::install::import_network(&root, &network);
        make_readable(&path);
        assert!(result.is_err(), "{result:?}");
        assert_eq!(load_installed(&path), sample());
    }

    #[test]
    fn a_change_to_a_missing_record_starts_from_an_empty_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installed.json");
        let saved = update_installed(&path, |record| record.active = sample().active).unwrap();
        assert_eq!(saved.active, sample().active);
        assert_eq!(load_installed(&path), saved);
    }

    #[test]
    fn a_missing_record_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            load_installed(&dir.path().join("installed.json")),
            Installed::default()
        );
    }

    #[test]
    fn the_record_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installed.json");
        save_installed(&path, &sample()).unwrap();
        assert_eq!(load_installed(&path), sample());
        assert_eq!(sample().active_set(), Some(&set("e", "n", 16)));
    }

    #[test]
    fn a_malformed_record_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installed.json");
        std::fs::write(&path, "{").unwrap();
        assert_eq!(load_installed(&path), Installed::default());
        let bad = bad_files(dir.path());
        assert_eq!(bad.len(), 1, "{bad:?}");
        assert_eq!(
            std::fs::read_to_string(dir.path().join(&bad[0])).unwrap(),
            "{"
        );
        assert!(!path.exists());
    }

    #[test]
    fn a_newer_schema_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installed.json");
        let mut newer = serde_json::to_value(sample()).unwrap();
        newer["schema"] = 2.into();
        std::fs::write(&path, newer.to_string()).unwrap();
        assert_eq!(load_installed(&path), Installed::default());
        assert_eq!(bad_files(dir.path()).len(), 1);
    }

    /// Ids and file names become folder names, so a record naming `..` would reach outside
    /// the install root.
    #[test]
    fn a_record_with_an_unsafe_name_is_kept_aside() {
        type Edit = fn(&mut serde_json::Value);
        let edits: [(&str, Edit); 6] = [
            ("engine id", |v| {
                v["engines"]["../x"] = v["engines"]["e"].clone();
            }),
            ("binary", |v| {
                v["engines"]["e"]["binary"] = "../katago".into()
            }),
            ("network file", |v| {
                v["networks"]["n"]["file"] = "/etc/passwd".into();
            }),
            ("runtime id", |v| {
                v["runtimes"]["..\\r"] = v["runtimes"]["r"].clone();
            }),
            ("set runtime", |v| v["sets"][0]["runtime"] = "..".into()),
            ("set config", |v| v["sets"][0]["config"] = "../x.cfg".into()),
        ];
        for (what, edit) in edits {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("installed.json");
            let mut value = serde_json::to_value(sample()).unwrap();
            edit(&mut value);
            std::fs::write(&path, value.to_string()).unwrap();
            assert_eq!(load_installed(&path), Installed::default(), "{what}");
            assert_eq!(bad_files(dir.path()).len(), 1, "{what}");
        }
    }

    #[test]
    fn saving_twice_concurrently_leaves_a_valid_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installed.json");
        let one = sample();
        let mut two = sample();
        two.put_set(set("e", "n", 32));
        for _ in 0..50 {
            let barrier = Arc::new(Barrier::new(2));
            let writers: Vec<_> = [one.clone(), two.clone()]
                .into_iter()
                .map(|record| {
                    let (barrier, path) = (Arc::clone(&barrier), path.clone());
                    thread::spawn(move || {
                        barrier.wait();
                        save_installed(&path, &record)
                    })
                })
                .collect();
            for writer in writers {
                writer.join().unwrap().expect("both saves succeed");
            }
            let loaded = load_installed(&path);
            assert!(loaded == one || loaded == two);
        }
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(
            names,
            ["installed.json"],
            "no temporary or bad file is left"
        );
    }

    #[test]
    fn engine_files_are_relative_to_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = InstallRoot::new(dir.path().to_path_buf());
        let installed = sample();
        let files = engine_files(&root, &installed, installed.active_set().unwrap()).unwrap();
        assert_eq!(files.config, Path::new("configs/e+n.cfg"));
        assert_eq!(files.model, Path::new("networks/n.bin.gz"));
        assert_eq!(files.working_dir, root.root());
        assert!(files.katago.is_absolute());
        assert_eq!(files.katago, root.engine_dir("e").join("katago.exe"));
        assert!(files.path_prepend.is_empty());
    }

    #[test]
    fn a_runtime_folder_goes_on_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = InstallRoot::new(dir.path().to_path_buf());
        let installed = sample();
        let with_runtime = EngineSet {
            runtime: Some("r".into()),
            ..set("e", "n", 16)
        };
        let files = engine_files(&root, &installed, &with_runtime).unwrap();
        assert_eq!(files.path_prepend, vec![root.runtime_dir("r")]);

        let unknown = EngineSet {
            runtime: Some("other".into()),
            ..set("e", "n", 16)
        };
        assert_eq!(engine_files(&root, &installed, &unknown), None);
        assert_eq!(
            engine_files(&root, &installed, &set("e", "missing", 16)),
            None
        );
    }

    #[test]
    fn put_set_replaces_the_same_key() {
        let mut installed = sample();
        installed.put_set(set("e", "n", 32));
        installed.put_set(set("e", "m", 8));
        assert_eq!(installed.sets.len(), 2);
        assert_eq!(installed.sets[0].threads, 32);
        assert_eq!(installed.active_set().map(|s| s.threads), Some(32));
    }

    #[test]
    fn an_active_key_without_a_set_gives_none() {
        let mut installed = sample();
        installed.active = Some(SetKey {
            engine: "e".into(),
            network: "gone".into(),
        });
        assert_eq!(installed.active_set(), None);
    }
}
