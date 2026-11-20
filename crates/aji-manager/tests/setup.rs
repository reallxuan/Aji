//! `Setup` answers from the manifest in use while a refresh is still pending.

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use aji_manager::OsKind;
use aji_manager::Setup;
use aji_manager::hardware::{CpuReport, HardwareReport, OsReport};
use aji_manager::manifest::{BUNDLED, ClientOptions, ManifestStore, http_client};

fn report() -> HardwareReport {
    HardwareReport {
        os: OsReport {
            kind: OsKind::Macos,
            version: String::new(),
            arch: "aarch64".into(),
        },
        cpu: CpuReport {
            name: "Apple M5".into(),
            cores: 10,
            threads: 10,
            avx2: false,
        },
        memory_bytes: 25_769_803_776,
        gpus: Vec::new(),
        problems: Vec::new(),
    }
}

#[tokio::test]
async fn setup_requests_do_not_wait_for_the_fetch() {
    let base = common::http::serve_silent();
    let cache = tempfile::tempdir().unwrap();
    let store = ManifestStore::open(BUNDLED, cache.path().join("manifest"), Vec::new());
    let setup = Arc::new(Setup::with_hardware(store, report()));

    let client = http_client(
        "Aji/test",
        ClientOptions {
            timeout: Some(Duration::from_secs(30)),
            ..ClientOptions::default()
        },
    )
    .expect("the client builds");
    let refreshing = Arc::clone(&setup);
    let fetch = tokio::spawn(async move {
        refreshing
            .manifest()
            .refresh(&client, &[base.as_str()])
            .await
    });
    // Let the refresh reach the silent server, so it is really pending.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!fetch.is_finished(), "the fetch should still be waiting");

    let started = Instant::now();
    let recommendation = setup.backends().await;
    assert!(started.elapsed() < Duration::from_millis(100));
    assert!(recommendation.default.is_some());
    fetch.abort();
}

#[tokio::test]
async fn refresh_runs_the_detector_again() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let cache = tempfile::tempdir().unwrap();
    let store = ManifestStore::open(BUNDLED, cache.path().join("manifest"), Vec::new());
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let setup = Setup::with_detector(
        store,
        Arc::new(move || {
            let n = counted.fetch_add(1, Ordering::SeqCst);
            let mut r = report();
            r.os.version = format!("detection {n}");
            r
        }),
    );
    assert_eq!(setup.hardware().await.os.version, "detection 0");
    assert_eq!(setup.hardware().await.os.version, "detection 0");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(setup.refresh().await.os.version, "detection 1");
    assert_eq!(setup.hardware().await.os.version, "detection 1");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}
