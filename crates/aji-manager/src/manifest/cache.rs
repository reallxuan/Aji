//! The on-disk copy of the last good manifest: `manifest.json` and `manifest.json.minisig`.

use std::fs;
use std::io;
use std::path::Path;

use super::select::{Candidate, Source};

const MANIFEST: &str = "manifest.json";
const SIGNATURE: &str = "manifest.json.minisig";

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
/// matching signature fails verification on load, and the bundled copy is used.
pub fn store_cache(dir: &Path, candidate: &Candidate) -> io::Result<()> {
    let signature = candidate.signature.as_deref().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "an unsigned manifest is not cached",
        )
    })?;
    fs::create_dir_all(dir)?;
    let manifest_tmp = dir.join(format!("{MANIFEST}.tmp"));
    let signature_tmp = dir.join(format!("{SIGNATURE}.tmp"));
    fs::write(&manifest_tmp, &candidate.bytes)?;
    fs::write(&signature_tmp, signature)?;
    fs::rename(&signature_tmp, dir.join(SIGNATURE))?;
    fs::rename(&manifest_tmp, dir.join(MANIFEST))
}
