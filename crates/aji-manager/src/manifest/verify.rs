//! Minisign verification of a manifest copy.

use minisign_verify::{Error, PublicKey, Signature};

use super::select::Rejection;

/// Checks `signature` (the text of a `.minisig` file) over `bytes`.
///
/// The signature names the key that made it, so only a key with that id is tried. No such key
/// gives [`Rejection::UnknownKey`]; a key that matches but does not verify gives
/// [`Rejection::BadSignature`]. Legacy (not prehashed) signatures are refused.
pub fn verify(bytes: &[u8], signature: &str, keys: &[PublicKey]) -> Result<(), Rejection> {
    let signature = Signature::decode(signature).map_err(|_| Rejection::BadSignature)?;
    let mut key_matched = false;
    for key in keys {
        match key.verify(bytes, &signature, false) {
            Ok(()) => return Ok(()),
            Err(Error::UnexpectedKeyId) => {}
            Err(_) => key_matched = true,
        }
    }
    Err(if key_matched {
        Rejection::BadSignature
    } else {
        Rejection::UnknownKey
    })
}
