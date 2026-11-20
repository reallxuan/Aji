//! Downloading against a local server: checksums, resume, several URLs, stalls, cancellation
//! and a change of download source mid-download.

mod common;

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use aji_manager::install::{
    DownloadError, DownloadItem, DownloadOptions, DownloadSource, Downloader, Origin,
};
use aji_manager::manifest::{ClientOptions, Digest, http_client};
use common::http::{FileMode, FileReply, TestServer, serve_files};
use sha2::Digest as _;
use tokio::sync::watch;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

const NAME: &str = "engine.zip";

/// 64 KiB that are not all one byte, so a misplaced range changes the hash.
fn body() -> Vec<u8> {
    (0..64 * 1024u32).map(|i| (i * 7 + i / 251) as u8).collect()
}

fn sha256(bytes: &[u8]) -> Digest {
    Digest::Sha256(hex(&sha2::Sha256::digest(bytes)))
}

fn md5(bytes: &[u8]) -> Digest {
    Digest::Md5(hex(&md5::Md5::digest(bytes)))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn item(urls: Vec<String>, bytes: &[u8]) -> DownloadItem {
    DownloadItem {
        name: NAME.into(),
        size: bytes.len() as u64,
        digest: sha256(bytes),
        urls,
        origin: Origin::Package,
    }
}

fn options(stall: Duration) -> DownloadOptions {
    DownloadOptions {
        stall,
        tries_per_url: 3,
        backoff: vec![Duration::from_millis(10)],
    }
}

fn client() -> reqwest::Client {
    let options = ClientOptions {
        timeout: None,
        connect_timeout: Duration::from_secs(5),
    };
    http_client("Aji/test", options).unwrap()
}

fn downloader(stall: Duration) -> (Downloader, watch::Sender<DownloadSource>) {
    let (tx, rx) = watch::channel(DownloadSource::Direct);
    (Downloader::new(client(), options(stall), rx), tx)
}

fn file(server: &TestServer) -> String {
    format!("{}/file", server.base)
}

fn serve(mode: FileMode, bytes: &[u8]) -> TestServer {
    serve_files(vec![(
        "/file",
        FileReply {
            body: bytes.to_vec(),
            mode,
        },
    )])
}

async fn fetch(
    downloader: &Downloader,
    item: &DownloadItem,
    dir: &Path,
) -> Result<std::path::PathBuf, DownloadError> {
    downloader
        .fetch(item, dir, &CancellationToken::new(), &mut |_, _| {})
        .await
}

fn part(dir: &Path) -> std::path::PathBuf {
    dir.join(format!("{NAME}.part"))
}

#[tokio::test]
async fn downloads_and_verifies_sha256() {
    let bytes = body();
    let server = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let mut last = (0, 0);
    let got = downloader
        .fetch(
            &item(vec![file(&server)], &bytes),
            dir.path(),
            &CancellationToken::new(),
            &mut |done, total| last = (done, total),
        )
        .await
        .unwrap();
    assert_eq!(got, dir.path().join(NAME));
    assert_eq!(std::fs::read(&got).unwrap(), bytes);
    assert!(!part(dir.path()).exists());
    assert_eq!(last, (bytes.len() as u64, bytes.len() as u64));
}

#[tokio::test]
async fn verifies_md5_for_networks() {
    let bytes = body();
    let server = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let mut network = item(vec![file(&server)], &bytes);
    network.digest = md5(&bytes);
    assert!(fetch(&downloader, &network, dir.path()).await.is_ok());

    network.digest = md5(b"something else");
    std::fs::remove_file(dir.path().join(NAME)).unwrap();
    assert_eq!(
        fetch(&downloader, &network, dir.path()).await,
        Err(DownloadError::Checksum)
    );
}

#[tokio::test]
async fn resumes_a_part_file_with_range() {
    let bytes = body();
    let half = bytes.len() / 2;
    let server = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(part(dir.path()), &bytes[..half]).unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let got = fetch(&downloader, &item(vec![file(&server)], &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(server.ranges(), [Some(format!("bytes={half}-"))]);
}

#[tokio::test]
async fn starts_over_when_the_server_ignores_range() {
    let bytes = body();
    let half = bytes.len() / 2;
    let server = serve(FileMode::IgnoreRange, &bytes);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(part(dir.path()), &bytes[..half]).unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let got = fetch(&downloader, &item(vec![file(&server)], &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(server.requests().len(), 1);
}

#[tokio::test]
async fn a_bad_checksum_moves_to_the_next_url() {
    let bytes = body();
    let bad = serve(FileMode::Corrupt, &bytes);
    let good = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let urls = vec![file(&bad), file(&good)];
    let got = fetch(&downloader, &item(urls, &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(
        bad.requests().len(),
        1,
        "a bad file from zero is not retried"
    );
    assert_eq!(good.ranges(), [None], "the next URL starts from zero");
}

#[tokio::test]
async fn a_mismatch_after_resume_retries_the_same_url_from_zero() {
    let bytes = body();
    let n = 1000;
    let server = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    // Bytes from an earlier host that do not match this file.
    std::fs::write(part(dir.path()), vec![0xAA; n]).unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let got = fetch(&downloader, &item(vec![file(&server)], &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(server.ranges(), [Some(format!("bytes={n}-")), None]);
}

#[tokio::test]
async fn a_404_moves_to_the_next_url() {
    let bytes = body();
    let missing = serve(FileMode::NotFound, &bytes);
    let good = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let urls = vec![file(&missing), file(&good)];
    assert!(
        fetch(&downloader, &item(urls, &bytes), dir.path())
            .await
            .is_ok()
    );
    assert_eq!(missing.requests().len(), 1, "a 404 is not retried");
}

/// A fetch from URLs that misbehave quickly must end; looping on them would never return.
async fn fetch_bounded(
    downloader: &Downloader,
    item: &DownloadItem,
    dir: &Path,
) -> Result<std::path::PathBuf, DownloadError> {
    tokio::time::timeout(Duration::from_secs(5), fetch(downloader, item, dir))
        .await
        .expect("the download ends instead of retrying one URL forever")
}

/// A "soft 404": a proxy or mirror that answers 200 with an error page instead of the file.
#[tokio::test]
async fn a_short_page_moves_on_to_the_next_url() {
    let bytes = body();
    let page = serve(FileMode::IgnoreRange, b"<html>Not found</html>");
    let good = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let urls = vec![file(&page), file(&good)];
    let got = fetch_bounded(&downloader, &item(urls, &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(page.requests().len(), 1, "a wrong length is not retried");
}

/// A stale mirror holding only the start of the file.
#[tokio::test]
async fn a_truncated_mirror_moves_on_to_the_next_url() {
    let bytes = body();
    let truncated = serve(FileMode::Normal, &bytes[..1000]);
    let good = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let urls = vec![file(&truncated), file(&good)];
    let got = fetch_bounded(&downloader, &item(urls, &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(truncated.requests().len(), 1);
}

/// Resuming against a server whose copy has another size: its `Content-Range` total says so.
#[tokio::test]
async fn a_resume_from_a_server_with_another_size_moves_on() {
    let bytes = body();
    let truncated = serve(FileMode::Normal, &bytes[..1000]);
    let good = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(part(dir.path()), &bytes[..500]).unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let urls = vec![file(&truncated), file(&good)];
    let got = fetch_bounded(&downloader, &item(urls, &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(truncated.ranges(), [Some("bytes=500-".to_string())]);
}

/// Without a `Content-Length` the short size shows only at the end of the body, which is a
/// wrong file, not a dropped connection.
#[tokio::test]
async fn a_short_chunked_body_moves_on_to_the_next_url() {
    let bytes = body();
    let truncated = serve(FileMode::Chunked, &bytes[..1000]);
    let good = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let urls = vec![file(&truncated), file(&good)];
    let got = fetch_bounded(&downloader, &item(urls, &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(truncated.requests().len(), 1);
}

/// A server that ignores `Range` and drops at the same byte every time starts over on each
/// try and never gets further, so its tries run out.
#[tokio::test]
async fn a_url_that_drops_at_the_same_byte_uses_up_its_tries() {
    let bytes = body();
    let dropping = serve(FileMode::DropAfter(1000), &bytes);
    let good = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let urls = vec![file(&dropping), file(&good)];
    let got = fetch_bounded(&downloader, &item(urls, &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    // The first drop made progress; the three after it got no further.
    assert_eq!(dropping.requests().len(), 4);
}

#[tokio::test]
async fn a_stalled_connection_is_dropped_and_resumed() {
    let bytes = body();
    let half = bytes.len() / 2;
    let server = serve(FileMode::StallAfter(half), &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_millis(200));
    let started = Instant::now();
    let got = fetch(&downloader, &item(vec![file(&server)], &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(server.ranges(), [None, Some(format!("bytes={half}-"))]);
    assert!(started.elapsed() < Duration::from_secs(5));
}

/// Bytes the download has reported, shared with a test.
#[derive(Clone, Default)]
struct Progress(Arc<AtomicU64>);

impl Progress {
    /// Waits until the download has reported `bytes`.
    async fn reach(&self, bytes: u64) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.0.load(Ordering::SeqCst) < bytes {
            assert!(Instant::now() < deadline, "the download never got there");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

/// Starts `item` in a task of its own, reporting into the returned `Progress`.
fn spawn_fetch(
    downloader: Downloader,
    item: DownloadItem,
    dir: &Path,
    cancel: CancellationToken,
) -> (
    tokio::task::JoinHandle<Result<std::path::PathBuf, DownloadError>>,
    Progress,
) {
    let progress = Progress::default();
    let seen = progress.clone();
    let dir = dir.to_path_buf();
    let job = tokio::spawn(async move {
        downloader
            .fetch(&item, &dir, &cancel, &mut |done, _| {
                seen.0.store(done, Ordering::SeqCst)
            })
            .await
    });
    (job, progress)
}

#[tokio::test]
async fn cancel_keeps_the_part_file() {
    let bytes = body();
    let half = bytes.len() / 2;
    let server = serve(FileMode::StallAfter(half), &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(60));
    let cancel = CancellationToken::new();
    let (job, progress) = spawn_fetch(
        downloader,
        item(vec![file(&server)], &bytes),
        dir.path(),
        cancel.clone(),
    );
    progress.reach(half as u64).await;
    cancel.cancel();
    let result = tokio::time::timeout(Duration::from_secs(5), job)
        .await
        .expect("cancel stops the download at once")
        .unwrap();
    assert_eq!(result, Err(DownloadError::Cancelled));
    assert_eq!(
        std::fs::metadata(part(dir.path())).unwrap().len(),
        half as u64,
        "the part file keeps what arrived"
    );
    assert!(!dir.path().join(NAME).exists());
}

/// A connection that keeps dropping but moves forward each time is not given up on: NVIDIA's
/// archives have one URL and are large.
#[tokio::test]
async fn a_drop_after_progress_does_not_use_up_a_try() {
    let bytes = body();
    let quarter = bytes.len() / 4;
    let server = serve(FileMode::StallAfter(quarter), &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (_tx, rx) = watch::channel(DownloadSource::Direct);
    let options = DownloadOptions {
        tries_per_url: 1,
        ..options(Duration::from_millis(200))
    };
    let downloader = Downloader::new(client(), options, rx);
    let got = fetch(&downloader, &item(vec![file(&server)], &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(server.ranges(), [None, Some(format!("bytes={quarter}-"))]);
}

#[tokio::test]
async fn a_body_longer_than_the_size_is_a_mismatch() {
    let bytes = body();
    let mut longer = bytes.clone();
    longer.extend_from_slice(&[1, 2, 3]);
    let server = serve(FileMode::Normal, &longer);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    assert_eq!(
        fetch(&downloader, &item(vec![file(&server)], &bytes), dir.path()).await,
        Err(DownloadError::Checksum)
    );
    assert!(
        !part(dir.path()).exists(),
        "a bad file from zero is deleted"
    );
}

#[tokio::test]
async fn every_url_failing_is_download_failed() {
    let bytes = body();
    let missing = serve(FileMode::NotFound, &bytes);
    let bad = serve(FileMode::Corrupt, &bytes);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    let result = fetch(
        &downloader,
        &item(vec![file(&missing), file(&bad)], &bytes),
        dir.path(),
    )
    .await;
    assert!(
        matches!(result, Err(DownloadError::Failed { .. })),
        "{result:?}"
    );
    // A host that refuses connections is retried, then given up.
    let closed = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}/file", listener.local_addr().unwrap())
    };
    let result = fetch(&downloader, &item(vec![closed], &bytes), dir.path()).await;
    assert!(
        matches!(&result, Err(DownloadError::Failed { last }) if !last.is_empty()),
        "{result:?}"
    );
}

#[tokio::test]
async fn a_verified_file_is_reused_without_a_request() {
    let bytes = body();
    let server = serve(FileMode::Normal, &bytes);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(NAME), &bytes).unwrap();
    let (downloader, _source) = downloader(Duration::from_secs(10));
    assert!(
        fetch(&downloader, &item(vec![file(&server)], &bytes), dir.path())
            .await
            .is_ok()
    );
    assert!(server.requests().is_empty());

    // A wrong file in its place is fetched again.
    std::fs::write(dir.path().join(NAME), b"stale").unwrap();
    let got = fetch(&downloader, &item(vec![file(&server)], &bytes), dir.path())
        .await
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(server.requests().len(), 1);
}

#[tokio::test]
async fn changing_the_source_drops_the_connection_and_continues() {
    let bytes = body();
    let half = bytes.len() / 2;
    let a = serve(FileMode::StallAfter(half), &bytes);
    let b = serve_files(vec![(
        format!("/{NAME}").as_str(),
        FileReply {
            body: bytes.clone(),
            mode: FileMode::Normal,
        },
    )]);
    let dir = tempfile::tempdir().unwrap();
    let (downloader, source) = downloader(Duration::from_secs(60));
    let (job, progress) = spawn_fetch(
        downloader,
        item(vec![file(&a)], &bytes),
        dir.path(),
        CancellationToken::new(),
    );
    progress.reach(half as u64).await;
    source
        .send(DownloadSource::Mirror {
            url: b.base.clone(),
        })
        .unwrap();
    let got = tokio::time::timeout(Duration::from_secs(10), job)
        .await
        .expect("the change of source is taken up at once")
        .unwrap()
        .unwrap();
    assert_eq!(std::fs::read(got).unwrap(), bytes);
    assert_eq!(b.ranges(), [Some(format!("bytes={half}-"))]);
}
