//! The on-disk copy of the last good manifest: `manifest.json` and `manifest.json.minisig`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use super::select::{Candidate, Source};

const MANIFEST: &str = "manifest.json";
const SIGNATURE: &str = "manifest.json.minisig";

/// Numbers the temporary files of this process.
static NEXT_TEMPORARY: AtomicU64 = AtomicU64::new(0);

/// `<name>.<pid>-<n>.tmp`: unique across the writers of this process and of any other.
fn temporary(dir: &Path, name: &str) -> PathBuf {
    let n = NEXT_TEMPORARY.fetch_add(1, Ordering::Relaxed);
    dir.join(format!("{name}.{}-{n}.tmp", std::process::id()))
}

/// Reads the cached copy, or `None` when either file is missing or unreadable. It is not
/// verified here; [`select`](super::select) does that.
pub fn load_cache(dir: &Path) -> Option<Candidate> {
    let bytes = fs::read(dir.join(MANIFEST)).ok()?;
    let signature = fs::read_to_string(dir.join(SIGNATURE)).ok()?;
    Some(Candidate {
        bytes,
        signature: Some(signature),
        source: Source::Cache,
    })
}

/// Writes both files through temporary files that are then renamed, so a crash leaves the old
/// copy rather than a half-written one. The signature is renamed first: a manifest without a
/// matching signature fails verification on load, and the bundled copy is used. Each write has
/// its own temporary names, so two writers never rename each other's files; a failed write
/// removes its own.
pub fn store_cache(dir: &Path, candidate: &Candidate) -> io::Result<()> {
    let signature = candidate.signature.as_deref().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "an unsigned manifest is not cached",
        )
    })?;
    fs::create_dir_all(dir)?;
    let manifest_tmp = temporary(dir, MANIFEST);
    let signature_tmp = temporary(dir, SIGNATURE);
    let result = (|| {
        fs::write(&manifest_tmp, &candidate.bytes)?;
        fs::write(&signature_tmp, signature)?;
        fs::rename(&signature_tmp, dir.join(SIGNATURE))?;
        fs::rename(&manifest_tmp, dir.join(MANIFEST))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&manifest_tmp);
        let _ = fs::remove_file(&signature_tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    #[test]
    fn cache_writes_use_unique_temporary_names() {
        let dir = tempfile::tempdir().unwrap();
        let candidate = Candidate {
            bytes: b"the manifest".to_vec(),
            signature: Some("the signature".to_string()),
            source: Source::Fetched,
        };
        // Two writers at once, many times over: with shared temporary names one of them
        // renames a file the other has already moved.
        for _ in 0..50 {
            let barrier = Arc::new(Barrier::new(2));
            let writers: Vec<_> = (0..2)
                .map(|_| {
                    let (barrier, dir, candidate) = (
                        Arc::clone(&barrier),
                        dir.path().to_path_buf(),
                        candidate.clone(),
                    );
                    thread::spawn(move || {
                        barrier.wait();
                        store_cache(&dir, &candidate)
                    })
                })
                .collect();
            for writer in writers {
                writer.join().unwrap().expect("both writes succeed");
            }
            let loaded = load_cache(dir.path()).expect("a cached copy");
            assert_eq!(loaded.bytes, candidate.bytes);
            assert_eq!(loaded.signature, candidate.signature);
        }
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "no temporary file is left behind");
    }
}
