//! Choosing between manifest copies, and the cache on disk.

mod common;

use aji_manager::manifest::{
    BUNDLED, Candidate, ManifestStore, Rejection, Source, load_cache, parse_manifest, select,
    store_cache,
};
use common::{TestKey, bundled_sequence, edited, manifest_with_sequence, signed};

fn rejected(selected: &aji_manager::manifest::Selected) -> Vec<Rejection> {
    selected.rejected.iter().map(|(_, r)| r.clone()).collect()
}

#[test]
fn a_signed_newer_manifest_wins() {
    let key = TestKey::generate();
    let newer = bundled_sequence() + 1;
    let candidate = signed(&key, manifest_with_sequence(newer), Source::Fetched);
    let selected = select(BUNDLED, vec![candidate], &[key.public()]);
    assert_eq!(selected.source, Source::Fetched);
    assert_eq!(selected.manifest.sequence, newer);
    assert!(selected.rejected.is_empty());
}

#[test]
fn an_unsigned_manifest_is_rejected() {
    let key = TestKey::generate();
    let candidate = Candidate {
        bytes: manifest_with_sequence(bundled_sequence() + 1),
        signature: None,
        source: Source::Fetched,
    };
    let selected = select(BUNDLED, vec![candidate], &[key.public()]);
    assert_eq!(selected.source, Source::Bundled);
    assert_eq!(rejected(&selected), vec![Rejection::Unsigned]);
}

#[test]
fn a_signature_by_another_key_is_rejected() {
    let trusted = TestKey::generate();
    let other = TestKey::generate();
    let candidate = signed(
        &other,
        manifest_with_sequence(bundled_sequence() + 1),
        Source::Fetched,
    );
    let selected = select(BUNDLED, vec![candidate], &[trusted.public()]);
    assert_eq!(selected.source, Source::Bundled);
    assert_eq!(rejected(&selected), vec![Rejection::UnknownKey]);
}

#[test]
fn with_no_trusted_keys_every_copy_is_rejected() {
    let key = TestKey::generate();
    let candidate = signed(
        &key,
        manifest_with_sequence(bundled_sequence() + 1),
        Source::Fetched,
    );
    let selected = select(BUNDLED, vec![candidate], &[]);
    assert_eq!(selected.source, Source::Bundled);
    assert_eq!(rejected(&selected), vec![Rejection::UnknownKey]);
}

#[test]
fn a_tampered_manifest_is_rejected() {
    let key = TestKey::generate();
    let mut candidate = signed(
        &key,
        manifest_with_sequence(bundled_sequence() + 1),
        Source::Fetched,
    );
    let last = candidate.bytes.len() - 1;
    candidate.bytes[last] ^= 1;
    let selected = select(BUNDLED, vec![candidate], &[key.public()]);
    assert_eq!(selected.source, Source::Bundled);
    assert_eq!(rejected(&selected), vec![Rejection::BadSignature]);
}

#[test]
fn an_older_or_equal_sequence_is_rejected() {
    let key = TestKey::generate();
    let current = bundled_sequence();
    let equal = signed(&key, manifest_with_sequence(current), Source::Fetched);
    let older = signed(&key, manifest_with_sequence(current - 1), Source::Cache);
    let selected = select(BUNDLED, vec![equal, older], &[key.public()]);
    assert_eq!(selected.source, Source::Bundled);
    assert_eq!(
        rejected(&selected),
        vec![
            Rejection::NotNewer {
                sequence: current,
                current
            },
            Rejection::NotNewer {
                sequence: current - 1,
                current
            },
        ]
    );
}

#[test]
fn a_newer_schema_is_rejected_even_when_signed() {
    let key = TestKey::generate();
    let bytes = edited(|v| {
        v["schema"] = 2.into();
        v["sequence"] = (bundled_sequence() + 1).into();
    });
    let candidate = signed(&key, bytes, Source::Fetched);
    let selected = select(BUNDLED, vec![candidate], &[key.public()]);
    assert_eq!(selected.source, Source::Bundled);
    assert_eq!(rejected(&selected), vec![Rejection::UnsupportedSchema(2)]);
}

#[test]
fn html_from_a_captive_portal_is_rejected() {
    let key = TestKey::generate();
    let html = b"<html><body>Sign in to the Wi-Fi</body></html>".to_vec();
    let signed_html = signed(&key, html.clone(), Source::Fetched);
    let unsigned_html = Candidate {
        bytes: html,
        signature: None,
        source: Source::Fetched,
    };
    let selected = select(BUNDLED, vec![signed_html, unsigned_html], &[key.public()]);
    assert_eq!(selected.source, Source::Bundled);
    let rejections = rejected(&selected);
    assert!(matches!(rejections[0], Rejection::Unparsable(_)));
    assert_eq!(rejections[1], Rejection::Unsigned);
}

#[test]
fn fetched_beats_cache_on_a_tie() {
    let key = TestKey::generate();
    let sequence = bundled_sequence() + 1;
    let cache = signed(&key, manifest_with_sequence(sequence), Source::Cache);
    let fetched = signed(&key, manifest_with_sequence(sequence), Source::Fetched);
    for order in [vec![cache.clone(), fetched.clone()], vec![fetched, cache]] {
        let selected = select(BUNDLED, order, &[key.public()]);
        assert_eq!(selected.source, Source::Fetched);
    }
}

#[test]
fn the_highest_sequence_wins() {
    let key = TestKey::generate();
    let current = bundled_sequence();
    let cache = signed(&key, manifest_with_sequence(current + 5), Source::Cache);
    let fetched = signed(&key, manifest_with_sequence(current + 2), Source::Fetched);
    let selected = select(BUNDLED, vec![fetched, cache], &[key.public()]);
    assert_eq!(selected.source, Source::Cache);
    assert_eq!(selected.manifest.sequence, current + 5);
}

#[test]
fn cache_round_trips_in_a_cjk_folder() {
    let key = TestKey::generate();
    let parent = tempfile::tempdir().expect("tempdir");
    let dir = parent.path().join("棋谱 测试").join("manifest");
    let candidate = signed(
        &key,
        manifest_with_sequence(bundled_sequence() + 1),
        Source::Fetched,
    );
    store_cache(&dir, &candidate).expect("store");
    let loaded = load_cache(&dir).expect("load");
    assert_eq!(loaded.source, Source::Cache);
    assert_eq!(loaded.bytes, candidate.bytes);
    assert_eq!(loaded.signature, candidate.signature);
    let selected = select(BUNDLED, vec![loaded], &[key.public()]);
    assert_eq!(selected.source, Source::Cache);
}

#[test]
fn a_missing_cache_loads_as_none() {
    let dir = tempfile::tempdir().expect("tempdir");
    assert!(load_cache(dir.path()).is_none());
}

#[test]
fn the_cache_is_verified_again_on_load() {
    let key = TestKey::generate();
    let dir = tempfile::tempdir().expect("tempdir");
    let candidate = signed(
        &key,
        manifest_with_sequence(bundled_sequence() + 1),
        Source::Fetched,
    );
    store_cache(dir.path(), &candidate).expect("store");

    let store = ManifestStore::open(BUNDLED, dir.path().to_path_buf(), vec![key.public()]);
    assert_eq!(store.current().source, Source::Cache);

    let file = dir.path().join("manifest.json");
    let mut bytes = std::fs::read(&file).expect("read");
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    std::fs::write(&file, bytes).expect("write");

    let store = ManifestStore::open(BUNDLED, dir.path().to_path_buf(), vec![key.public()]);
    let current = store.current();
    assert_eq!(current.source, Source::Bundled);
    assert_eq!(rejected(&current), vec![Rejection::BadSignature]);
}

#[test]
fn a_legacy_signature_is_rejected() {
    let key = TestKey::generate();
    let bytes = manifest_with_sequence(bundled_sequence() + 1);
    let legacy = key.sign_legacy(&bytes);
    // The signature is genuine: it verifies once legacy signatures are allowed.
    let decoded = minisign_verify::Signature::decode(&legacy).expect("a legacy signature");
    assert!(key.public().verify(&bytes, &decoded, true).is_ok());

    let candidate = Candidate {
        bytes,
        signature: Some(legacy),
        source: Source::Fetched,
    };
    let selected = select(BUNDLED, vec![candidate], &[key.public()]);
    assert_eq!(selected.source, Source::Bundled);
    assert_eq!(rejected(&selected), vec![Rejection::BadSignature]);
}

#[test]
fn unknown_runtime_platform_and_network_kind_are_dropped() {
    let bytes = edited(|v| {
        let mut runtime = v["runtimes"][0].clone();
        runtime["id"] = "x-runtime".into();
        runtime["platform"] = "freebsd-x64".into();
        v["runtimes"].as_array_mut().unwrap().push(runtime);
        let mut network = v["networks"][0].clone();
        network["id"] = "x-network".into();
        network["kind"] = "future".into();
        v["networks"].as_array_mut().unwrap().push(network);
    });
    let manifest = parse_manifest(&bytes).expect("still parses");
    let bundled = parse_manifest(BUNDLED).expect("bundled parses");
    assert_eq!(manifest.runtimes.len(), bundled.runtimes.len());
    assert_eq!(manifest.networks.len(), bundled.networks.len());
    assert!(manifest.runtimes.iter().all(|r| r.id != "x-runtime"));
    assert!(manifest.networks.iter().all(|n| n.id != "x-network"));
}

#[test]
fn source_serialises_in_lowercase() {
    for (source, text) in [
        (Source::Bundled, "bundled"),
        (Source::Cache, "cache"),
        (Source::Fetched, "fetched"),
    ] {
        assert_eq!(
            serde_json::to_value(source).unwrap(),
            serde_json::json!(text)
        );
    }
}
