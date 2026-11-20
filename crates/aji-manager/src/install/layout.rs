//! Where the install files live (design 5.2). Every name below comes from a manifest id or
//! file name, which `parse_manifest` has checked is a plain name.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Numbers the staging folders of this process.
static NEXT_STAGING: AtomicU64 = AtomicU64::new(0);

/// The install root, `app_local_data_dir`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallRoot {
    root: PathBuf,
}

impl InstallRoot {
    /// `root` is made absolute, so KataGo's program path is absolute too.
    pub fn new(root: PathBuf) -> InstallRoot {
        let root = std::path::absolute(&root).unwrap_or(root);
        InstallRoot { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `engines/<id>`: the unpacked KataGo package.
    pub fn engine_dir(&self, engine: &str) -> PathBuf {
        self.root.join("engines").join(engine)
    }

    /// `runtimes/<id>`: the NVIDIA DLLs, flat in one folder.
    pub fn runtime_dir(&self, runtime: &str) -> PathBuf {
        self.root.join("runtimes").join(runtime)
    }

    /// `networks/<file name>`, as downloaded.
    pub fn network_file(&self, file_name: &str) -> PathBuf {
        self.root.join("networks").join(file_name)
    }

    /// `configs/<engine>+<network>.cfg`, relative to the root: the analysis config.
    pub fn config_rel(&self, engine: &str, network: &str) -> PathBuf {
        Path::new("configs").join(format!("{engine}+{network}.cfg"))
    }

    /// `configs/<engine>+<network>.benchmark.cfg`, relative to the root.
    pub fn benchmark_config_rel(&self, engine: &str, network: &str) -> PathBuf {
        Path::new("configs").join(format!("{engine}+{network}.benchmark.cfg"))
    }

    /// `downloads/`: the `.part` files, kept for resume.
    pub fn downloads_dir(&self) -> PathBuf {
        self.root.join("downloads")
    }

    /// A new, empty folder under `staging/`, on the same volume as the final folders so that
    /// one rename moves an unpacked package into place.
    pub fn new_staging_dir(&self) -> io::Result<PathBuf> {
        let staging = self.root.join("staging");
        fs::create_dir_all(&staging)?;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        loop {
            let n = NEXT_STAGING.fetch_add(1, Ordering::Relaxed);
            let dir = staging.join(format!("{}-{nanos}-{n}", std::process::id()));
            match fs::create_dir(&dir) {
                Ok(()) => return Ok(dir),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
    }

    /// `installed.json`.
    pub fn record_file(&self) -> PathBuf {
        self.root.join("installed.json")
    }

    /// KataGo's `homeDataDir`, relative to the root (its working directory). It holds only the
    /// OpenCL tuning files.
    pub fn katago_home_rel() -> &'static str {
        "katago-home"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_follow_the_design() {
        let dir = tempfile::tempdir().unwrap();
        let root = InstallRoot::new(dir.path().to_path_buf());
        assert_eq!(root.root(), dir.path());
        assert_eq!(root.engine_dir("e"), dir.path().join("engines").join("e"));
        assert_eq!(root.runtime_dir("r"), dir.path().join("runtimes").join("r"));
        assert_eq!(
            root.network_file("n.bin.gz"),
            dir.path().join("networks").join("n.bin.gz")
        );
        assert_eq!(root.config_rel("e", "n"), Path::new("configs/e+n.cfg"));
        assert_eq!(
            root.benchmark_config_rel("e", "n"),
            Path::new("configs/e+n.benchmark.cfg")
        );
        assert_eq!(root.downloads_dir(), dir.path().join("downloads"));
        assert_eq!(root.record_file(), dir.path().join("installed.json"));
        assert_eq!(InstallRoot::katago_home_rel(), "katago-home");
    }

    #[test]
    fn a_relative_root_is_made_absolute() {
        let root = InstallRoot::new(PathBuf::from("aji-data"));
        assert!(root.root().is_absolute());
    }

    #[test]
    fn staging_folders_are_new_each_time() {
        let dir = tempfile::tempdir().unwrap();
        let root = InstallRoot::new(dir.path().to_path_buf());
        let a = root.new_staging_dir().unwrap();
        let b = root.new_staging_dir().unwrap();
        assert_ne!(a, b);
        assert!(a.is_dir() && b.is_dir());
        assert_eq!(a.parent().unwrap(), dir.path().join("staging"));
    }
}
