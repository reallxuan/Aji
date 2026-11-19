//! The public keys whose signatures Aji trusts.

use minisign_verify::PublicKey;

/// Minisign public keys in base64. It stays empty until the release key exists, so until then
/// every fetched or cached copy is rejected and the bundled one is used.
pub const TRUSTED_KEYS: &[&str] = &[];

/// Parses [`TRUSTED_KEYS`].
///
/// # Panics
///
/// Panics if a constant is not a valid key. `every_trusted_key_parses` guards that.
pub fn trusted_keys() -> Vec<PublicKey> {
    TRUSTED_KEYS
        .iter()
        .map(|k| PublicKey::from_base64(k).expect("TRUSTED_KEYS holds a valid minisign key"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_trusted_key_parses() {
        assert_eq!(trusted_keys().len(), TRUSTED_KEYS.len());
    }
}
