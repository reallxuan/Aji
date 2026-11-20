//! Writes that never leave a half-written file: each goes to a temporary file with a name of
//! its own, which is then renamed into place.

use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Numbers the temporary files of this process.
static NEXT_TEMPORARY: AtomicU64 = AtomicU64::new(0);

/// `<dir>/<name>.<pid>-<n>.tmp`: unique across the writers of this process and of any other.
pub(crate) fn temporary(dir: &Path, name: &str) -> PathBuf {
    let n = NEXT_TEMPORARY.fetch_add(1, Ordering::Relaxed);
    dir.join(format!("{name}.{}-{n}.tmp", std::process::id()))
}

/// Writes `bytes` to `path` through a temporary file in the same folder. The temporary file
/// reaches the disk before the rename, so a power cut leaves the old file or the new one, not
/// an empty one. A failed write removes its temporary file and leaves `path` as it was.
pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = temporary(dir, &name);
    let result = fs::File::create(&tmp)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
