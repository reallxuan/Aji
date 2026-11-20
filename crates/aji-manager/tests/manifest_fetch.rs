//! Fetching the manifest from a local test server.

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use aji_manager::manifest::{
    BUNDLED, ClientOptions, FetchError, ManifestStore, Source, fetch, http_client, load_cache,
};
use common::http::{Gate, Reply, serve, serve_silent};
use common::{TestKey, bundled_sequence, manifest_with_sequence};

const MAX: usize = 4 * 1024 * 1024;

fn client(timeout: Duration) -> reqwest::Client {
    http_client(
        "Aji/test",
        ClientOptions {
            timeout: Some(timeout),
            ..ClientOptions::default()
        },
    )
    .expect("the client builds")
}

#[test]
fn http_client_builds() {
    assert!(http_client("Aji/test", ClientOptions::default()).is_ok());
    let unlimited = ClientOptions {
        timeout: None,
        connect_timeout: Duration::from_secs(15),
    };
    assert!(http_client("Aji/test", unlimited).is_ok());
}

#[test]
fn an_invalid_user_agent_is_an_error_not_a_panic() {
    let result = http_client("Aji/\n", ClientOptions::default());
    assert!(matches!(result, Err(FetchError::Client(_))));
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
async fn a_body_over_4_mib_without_content_length_is_rejected() {
    let base = serve(vec![
        ("/manifest.json", Reply::ok(vec![b'x'; MAX + 1]).chunked()),
        ("/manifest.json.minisig", Reply::ok("s")),
    ]);
    let error = fetch(&client(Duration::from_secs(10)), &[&base])
        .await
        .err();
    assert!(matches!(error, Some(FetchError::TooLarge)), "{error:?}");
}

#[tokio::test]
async fn a_chunked_body_of_exactly_4_mib_is_accepted() {
    let base = serve(vec![
        ("/manifest.json", Reply::ok(vec![b'x'; MAX]).chunked()),
        ("/manifest.json.minisig", Reply::ok("s")),
    ]);
    let got = fetch(&client(Duration::from_secs(10)), &[&base])
        .await
        .expect("fetch");
    assert_eq!(got.bytes.len(), MAX);
}

/// HTTP/1.1 frames the body by `Content-Length`, so the client reads the 100 bytes declared and
/// never the 4 MiB behind them: nothing over the limit reaches memory.
#[tokio::test]
async fn a_body_longer_than_its_content_length_is_cut_at_the_declared_length() {
    let base = serve(vec![
        (
            "/manifest.json",
            Reply::ok(vec![b'x'; MAX + 1]).with_length(100),
        ),
        ("/manifest.json.minisig", Reply::ok("s")),
    ]);
    let got = fetch(&client(Duration::from_secs(10)), &[&base]).await;
    assert_eq!(got.map(|c| c.bytes.len()).ok(), Some(100));
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
        .await
        .expect("refresh");
    assert_eq!(source, Source::Fetched);
    assert_eq!(store.current().manifest.sequence, bundled_sequence() + 1);
    assert_eq!(load_cache(&cache).expect("cached").bytes, bytes);

    let reopened = ManifestStore::open(BUNDLED, cache, vec![key.public()]);
    assert_eq!(reopened.current().source, Source::Cache);
}

#[tokio::test]
async fn refresh_reports_a_failed_fetch() {
    let key = TestKey::generate();
    let dir = tempfile::tempdir().expect("tempdir");
    let store = ManifestStore::open(BUNDLED, dir.path().join("manifest"), vec![key.public()]);
    let base = serve(vec![]);
    let result = store
        .refresh(&client(Duration::from_secs(5)), &[&base])
        .await;
    assert!(matches!(result, Err(FetchError::Status(404))), "{result:?}");
    assert_eq!(store.current().source, Source::Bundled);
}

#[tokio::test]
async fn an_older_fetched_copy_never_replaces_a_newer_current_one() {
    let key = TestKey::generate();
    let older = manifest_with_sequence(bundled_sequence() + 1);
    let newer = manifest_with_sequence(bundled_sequence() + 2);
    let gate = Gate::default();
    let slow = serve(vec![
        ("/manifest.json", Reply::ok(older.clone()).held(&gate)),
        ("/manifest.json.minisig", Reply::ok(key.sign(&older))),
    ]);
    let fast = serve(vec![
        ("/manifest.json", Reply::ok(newer.clone())),
        ("/manifest.json.minisig", Reply::ok(key.sign(&newer))),
    ]);
    let dir = tempfile::tempdir().expect("tempdir");
    let cache = dir.path().join("manifest");
    let store = Arc::new(ManifestStore::open(
        BUNDLED,
        cache.clone(),
        vec![key.public()],
    ));
    let client = client(Duration::from_secs(5));

    // The slow refresh starts while the bundled copy is current, and waits on its server.
    let slow_refresh = {
        let store = Arc::clone(&store);
        let client = client.clone();
        tokio::spawn(async move { store.refresh(&client, &[slow.as_str()]).await })
    };
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        !slow_refresh.is_finished(),
        "the slow refresh should be waiting"
    );

    // A faster refresh swaps the newer copy in meanwhile.
    store
        .refresh(&client, &[&fast])
        .await
        .expect("fast refresh");
    assert_eq!(store.current().manifest.sequence, bundled_sequence() + 2);

    gate.open();
    slow_refresh.await.unwrap().expect("slow refresh");
    assert_eq!(store.current().manifest.sequence, bundled_sequence() + 2);
    assert_eq!(load_cache(&cache).expect("cached").bytes, newer);
}
