//! The public keys whose signatures Aji trusts.

use minisign_verify::PublicKey;

/// Minisign public keys in base64.
///
/// Key id ABDFEC3DB730B0C2: `keys/aji-manifest.pub` in the `reallxuan/aji-manifest` repository.
pub const TRUSTED_KEYS: &[&str] = &["RWTCsDC3Pezfq26GP5M7KIYhmFd7TMMUXag4lxVzJb+IQqfahCp1fMDh"];

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
    fn trusted_keys_decode() {
        assert_eq!(trusted_keys().len(), 1);
    }

    #[test]
    fn every_trusted_key_parses() {
        assert_eq!(trusted_keys().len(), TRUSTED_KEYS.len());
    }
}
