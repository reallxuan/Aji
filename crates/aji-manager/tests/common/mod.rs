//! Helpers shared by the integration tests. Each test binary uses only some of them.
#![allow(dead_code)]

pub mod http;

use std::io::Cursor;

use aji_manager::manifest::{BUNDLED, Candidate, Source, parse_manifest};
use minisign_verify::PublicKey;

/// A throw-away signing key and the matching public key for `select` and `ManifestStore`.
pub struct TestKey {
    pair: minisign::KeyPair,
}

impl TestKey {
    pub fn generate() -> TestKey {
        TestKey {
            pair: minisign::KeyPair::generate_unencrypted_keypair().expect("a key pair"),
        }
    }

    pub fn public(&self) -> PublicKey {
        PublicKey::from_base64(&self.pair.pk.to_base64()).expect("a public key")
    }

    pub fn sign(&self, bytes: &[u8]) -> String {
        minisign::sign(
            Some(&self.pair.pk),
            &self.pair.sk,
            Cursor::new(bytes),
            None,
            None,
        )
        .expect("a signature")
        .into_string()
    }

    /// A legacy minisign signature (algorithm `Ed`): Ed25519 over the raw bytes, not over their
    /// BLAKE2b-512 hash. minisign 0.10 only makes prehashed ones, so the box is built here from
    /// the key's seed. The secret key's bytes are: algorithm ids (6), KDF salt (32), KDF limits
    /// (16), key id (8), then the libsodium secret key, whose first 32 bytes are the seed.
    pub fn sign_legacy(&self, bytes: &[u8]) -> String {
        use ct_codecs::{Base64, Encoder};
        let secret = self.pair.sk.to_bytes();
        let key_id = &secret[54..62];
        let pair = ring::signature::Ed25519KeyPair::from_seed_unchecked(&secret[62..94])
            .expect("an Ed25519 seed");
        let signature = pair.sign(bytes);
        let mut line = b"Ed".to_vec();
        line.extend_from_slice(key_id);
        line.extend_from_slice(signature.as_ref());
        let trusted = "timestamp:0";
        let mut global = signature.as_ref().to_vec();
        global.extend_from_slice(trusted.as_bytes());
        let global = pair.sign(&global);
        format!(
            "untrusted comment: legacy\n{}\ntrusted comment: {trusted}\n{}\n",
            Base64::encode_to_string(&line).expect("base64"),
            Base64::encode_to_string(global.as_ref()).expect("base64"),
        )
    }
}

pub fn bundled_sequence() -> u64 {
    parse_manifest(BUNDLED).expect("bundled parses").sequence
}

/// The bundled manifest with `sequence` replaced.
pub fn manifest_with_sequence(sequence: u64) -> Vec<u8> {
    edited(|v| v["sequence"] = sequence.into())
}

pub fn edited(edit: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
    let mut v: serde_json::Value = serde_json::from_slice(BUNDLED).expect("bundled is JSON");
    edit(&mut v);
    serde_json::to_vec_pretty(&v).expect("serialises")
}

pub fn signed(key: &TestKey, bytes: Vec<u8>, source: Source) -> Candidate {
    let signature = Some(key.sign(&bytes));
    Candidate {
        bytes,
        signature,
        source,
    }
}
