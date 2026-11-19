//! Generates Aji's install manifest.

use sha2::{Digest, Sha256};

pub mod generate;
pub mod networks;
pub mod nvidia;
pub mod releases;

/// Writes `bytes` to `out`, creating the parent folder first when there is one.
pub fn write_output(out: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = out.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(out, bytes).map_err(|e| format!("{}: {e}", out.display()))
}

/// The SHA-256 of `bytes` as 64 lowercase hex digits.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The date part, `YYYY-MM-DD`, of an RFC 3339 time.
pub(crate) fn date_of(time: &str) -> Result<String, String> {
    let d = time.get(..10).unwrap_or("");
    let ok = d.len() == 10
        && d.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    if ok {
        Ok(d.to_owned())
    } else {
        Err(format!("{time:?} is not an RFC 3339 time"))
    }
}
