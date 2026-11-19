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
