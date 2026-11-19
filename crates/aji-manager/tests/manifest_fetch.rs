//! Fetching the manifest from a local test server.

mod common;

use std::time::{Duration, Instant};

use aji_manager::manifest::{
    BUNDLED, ClientOptions, ManifestStore, Source, fetch, http_client, load_cache,
};
use common::http::{Reply, serve, serve_silent};
use common::{TestKey, bundled_sequence, manifest_with_sequence};

fn client(timeout: Duration) -> reqwest::Client {
    http_client("Aji/test", ClientOptions { timeout })
}

#[tokio::test]
async fn fetch_reads_both_files() {
    let base = serve(vec![
        ("/v1/manifest.json", Reply::ok("the manifest")),
        ("/v1/manifest.json.minisig", Reply::ok("the signature")),
    ]);
    let got = fetch(&client(Duration::from_secs(5)), &[&format!("{base}/v1")])
        .await
        .expect("fetch");
    assert_eq!(got.bytes, b"the manifest");
    assert_eq!(got.signature.as_deref(), Some("the signature"));
    assert_eq!(got.source, Source::Fetched);
}

#[tokio::test]
async fn fetch_falls_back_to_the_next_base_url() {
    let missing = serve(vec![]);
    let working = serve(vec![
        ("/manifest.json", Reply::ok("m")),
        ("/manifest.json.minisig", Reply::ok("s")),
    ]);
    let got = fetch(&client(Duration::from_secs(5)), &[&missing, &working])
        .await
        .expect("fetch");
    assert_eq!(got.bytes, b"m");
}

#[tokio::test]
async fn fetch_gives_up_within_the_timeout() {
    let base = serve_silent();
    let started = Instant::now();
    let result = fetch(&client(Duration::from_millis(300)), &[&base]).await;
    assert!(result.is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn fetch_rejects_a_body_over_4_mib() {
    let base = serve(vec![
        ("/manifest.json", Reply::ok(vec![b'x'; 4 * 1024 * 1024 + 1])),
        ("/manifest.json.minisig", Reply::ok("s")),
    ]);
    let result = fetch(&client(Duration::from_secs(10)), &[&base]).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn fetch_accepts_a_body_of_exactly_4_mib() {
    let base = serve(vec![
        ("/manifest.json", Reply::ok(vec![b'x'; 4 * 1024 * 1024])),
        ("/manifest.json.minisig", Reply::ok("s")),
    ]);
    let got = fetch(&client(Duration::from_secs(10)), &[&base])
        .await
        .expect("fetch");
    assert_eq!(got.bytes.len(), 4 * 1024 * 1024);
}

#[tokio::test]
async fn refresh_stores_a_winner_in_the_cache() {
    let key = TestKey::generate();
    let bytes = manifest_with_sequence(bundled_sequence() + 1);
    let signature = key.sign(&bytes);
    let base = serve(vec![
        ("/manifest.json", Reply::ok(bytes.clone())),
        ("/manifest.json.minisig", Reply::ok(signature)),
    ]);
    let dir = tempfile::tempdir().expect("tempdir");
    let cache = dir.path().join("manifest");
    let store = ManifestStore::open(BUNDLED, cache.clone(), vec![key.public()]);
    assert_eq!(store.current().source, Source::Bundled);

    let source = store
        .refresh(&client(Duration::from_secs(5)), &[&base])
        .await;
    assert_eq!(source, Source::Fetched);
    assert_eq!(store.current().manifest.sequence, bundled_sequence() + 1);
    assert_eq!(load_cache(&cache).expect("cached").bytes, bytes);

    let reopened = ManifestStore::open(BUNDLED, cache, vec![key.public()]);
    assert_eq!(reopened.current().source, Source::Cache);
}

#[tokio::test]
async fn refresh_keeps_the_current_copy_when_the_fetch_fails() {
    let key = TestKey::generate();
    let dir = tempfile::tempdir().expect("tempdir");
    let store = ManifestStore::open(BUNDLED, dir.path().join("manifest"), vec![key.public()]);
    let base = serve(vec![]);
    let source = store
        .refresh(&client(Duration::from_secs(5)), &[&base])
        .await;
    assert_eq!(source, Source::Bundled);
}
