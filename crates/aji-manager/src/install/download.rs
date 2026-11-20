//! Downloading one file with resume, a streamed checksum, several URLs, stall detection and
//! cancellation (design 5.3).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use sha2::Digest as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use super::{DownloadSource, Origin, candidate_urls};
use crate::manifest::Digest;

/// One file to fetch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadItem {
    /// The file name, a plain name checked by `parse_manifest`.
    pub name: String,
    pub size: u64,
    pub digest: Digest,
    pub urls: Vec<String>,
    pub origin: Origin,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadOptions {
    /// No byte for this long drops the connection.
    pub stall: Duration,
    /// Attempts per URL before the next URL.
    pub tries_per_url: u32,
    /// The pauses between attempts on one URL; the last repeats.
    pub backoff: Vec<Duration>,
}

impl Default for DownloadOptions {
    fn default() -> Self {
        DownloadOptions {
            stall: Duration::from_secs(30),
            tries_per_url: 3,
            backoff: vec![Duration::from_secs(1), Duration::from_secs(4)],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadError {
    /// Every URL failed; `last` says how the last one did.
    Failed {
        last: String,
    },
    /// Every URL gave a file whose checksum did not match.
    Checksum,
    Cancelled,
    /// A local file could not be read or written.
    Io(String),
}

pub struct Downloader {
    client: reqwest::Client,
    options: DownloadOptions,
    source: watch::Receiver<DownloadSource>,
}

impl Downloader {
    pub fn new(
        client: reqwest::Client,
        options: DownloadOptions,
        source: watch::Receiver<DownloadSource>,
    ) -> Downloader {
        Downloader {
            client,
            options,
            source,
        }
    }

    /// Into `dir/<name>.part`, then renamed to `dir/<name>` once its digest matches. A complete
    /// `dir/<name>` already there is hashed and reused when it matches. `progress` gets the
    /// bytes on disk and the size after every chunk; the caller throttles it.
    ///
    /// URLs come from `candidate_urls` and are tried in order. A URL is left after a 4xx, after
    /// a file that does not match (one retry from zero first when the bytes were resumed), or
    /// after `tries_per_url` attempts that dropped without receiving a byte. A change of
    /// download source drops the connection and starts over at the new first URL, keeping the
    /// part file.
    pub async fn fetch(
        &self,
        item: &DownloadItem,
        dir: &Path,
        cancel: &CancellationToken,
        progress: &mut (dyn FnMut(u64, u64) + Send),
    ) -> Result<PathBuf, DownloadError> {
        tokio::fs::create_dir_all(dir).await.map_err(io)?;
        let target = dir.join(&item.name);
        let part = dir.join(format!("{}.part", item.name));
        if file_len(&target).await? == Some(item.size) {
            if hash_file(&target, item.size, &item.digest, cancel)
                .await?
                .matches(&item.digest)
            {
                progress(item.size, item.size);
                return Ok(target);
            }
            eprintln!(
                "aji: {} on disk does not match; fetching it again",
                item.name
            );
        }
        remove(&target).await?;

        let mut source = self.source.clone();
        let mut partial = Partial::new(&item.digest);
        let mut index = 0;
        let mut tries = 0;
        let mut tried_any = false;
        let mut all_bad = true;
        let mut last = String::from("no URL to fetch from");
        loop {
            if cancel.is_cancelled() {
                return Err(DownloadError::Cancelled);
            }
            let urls = candidate_urls(
                &source.borrow_and_update(),
                item.origin,
                &item.name,
                &item.urls,
            );
            let Some(url) = urls.get(index) else {
                return Err(if tried_any && all_bad {
                    DownloadError::Checksum
                } else {
                    DownloadError::Failed { last }
                });
            };
            let host = host_of(url);
            let started = Instant::now();
            let outcome = self
                .attempt(
                    url,
                    item,
                    &part,
                    &mut partial,
                    cancel,
                    &mut source,
                    progress,
                )
                .await?;
            match outcome {
                Outcome::Complete { transferred } => {
                    tokio::fs::rename(&part, &target).await.map_err(io)?;
                    eprintln!(
                        "aji: downloaded {}: {transferred} of {} bytes in {:.1} s from {host}",
                        item.name,
                        item.size,
                        started.elapsed().as_secs_f64()
                    );
                    return Ok(target);
                }
                Outcome::Mismatch { resumed } => {
                    tried_any = true;
                    eprintln!("aji: {} from {host} does not match its checksum", item.name);
                    truncate(&part, 0).await?;
                    partial = Partial::new(&item.digest);
                    if resumed {
                        // The resumed bytes may have come from another host or another file.
                        continue;
                    }
                    remove(&part).await?;
                    last = format!("{host}: the file does not match its checksum");
                    index += 1;
                    tries = 0;
                }
                Outcome::Refused(reason) => {
                    tried_any = true;
                    all_bad = false;
                    eprintln!("aji: {} from {host}: {reason}", item.name);
                    last = format!("{host}: {reason}");
                    index += 1;
                    tries = 0;
                }
                Outcome::Transient { reason, progressed } => {
                    eprintln!("aji: {} from {host}: {reason}", item.name);
                    last = format!("{host}: {reason}");
                    if !progressed {
                        tries += 1;
                    }
                    if tries >= self.options.tries_per_url {
                        tried_any = true;
                        all_bad = false;
                        index += 1;
                        tries = 0;
                        continue;
                    }
                    let backoff = &self.options.backoff;
                    let pause = backoff
                        .get(tries.saturating_sub(1) as usize)
                        .or(backoff.last())
                        .copied()
                        .unwrap_or_default();
                    tokio::select! {
                        biased;
                        () = cancel.cancelled() => return Err(DownloadError::Cancelled),
                        () = source_changed(&mut source) => {
                            (index, tries, tried_any, all_bad) = (0, 0, false, true);
                        }
                        () = tokio::time::sleep(pause) => {}
                    }
                }
                Outcome::SourceChanged => {
                    eprintln!("aji: download source changed; {} starts over", item.name);
                    (index, tries, tried_any, all_bad) = (0, 0, false, true);
                }
            }
        }
    }

    /// One request to `url`, appending to the part file from where it ends.
    #[allow(clippy::too_many_arguments)]
    async fn attempt(
        &self,
        url: &str,
        item: &DownloadItem,
        part: &Path,
        partial: &mut Partial,
        cancel: &CancellationToken,
        source: &mut watch::Receiver<DownloadSource>,
        progress: &mut (dyn FnMut(u64, u64) + Send),
    ) -> Result<Outcome, DownloadError> {
        let mut have = file_len(part).await?.unwrap_or(0);
        if have > item.size {
            truncate(part, 0).await?;
            have = 0;
        }
        if partial.len != have {
            *partial = hash_file(part, have, &item.digest, cancel).await?;
        }
        let mut resumed = have > 0;
        progress(have, item.size);
        if have == item.size {
            return Ok(if partial.matches(&item.digest) {
                Outcome::Complete { transferred: 0 }
            } else {
                Outcome::Mismatch { resumed }
            });
        }

        let mut request = self.client.get(url);
        if have > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let mut response = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(DownloadError::Cancelled),
            () = source_changed(source) => return Ok(Outcome::SourceChanged),
            sent = tokio::time::timeout(self.options.stall, request.send()) => match sent {
                Err(_) => return Ok(Outcome::transient("no response", false)),
                Ok(Err(e)) => return Ok(Outcome::transient(&describe(e), false)),
                Ok(Ok(response)) => response,
            },
        };
        let status = response.status();
        match status.as_u16() {
            200 => {
                if have > 0 {
                    // The server ignored the range: start over from its first byte.
                    truncate(part, 0).await?;
                    *partial = Partial::new(&item.digest);
                    have = 0;
                    resumed = false;
                }
            }
            206 => {
                let range = response
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or_default();
                if !range.starts_with(&format!("bytes {have}-")) {
                    let reason = format!("unexpected Content-Range {range:?}");
                    return Ok(Outcome::transient(&reason, false));
                }
            }
            // The server's file is shorter than the bytes already here: not this file.
            416 if have > 0 => return Ok(Outcome::Mismatch { resumed: true }),
            408 | 429 => return Ok(Outcome::transient(&format!("HTTP {status}"), false)),
            400..=499 => return Ok(Outcome::Refused(format!("HTTP {status}"))),
            _ => return Ok(Outcome::transient(&format!("HTTP {status}"), false)),
        }

        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(part)
            .await
            .map_err(io)?;
        let mut writer = BufWriter::with_capacity(256 * 1024, file);
        let from = have;
        let outcome = loop {
            let chunk = tokio::select! {
                biased;
                () = cancel.cancelled() => {
                    writer.flush().await.map_err(io)?;
                    return Err(DownloadError::Cancelled);
                }
                () = source_changed(source) => break Outcome::SourceChanged,
                chunk = tokio::time::timeout(self.options.stall, response.chunk()) => chunk,
            };
            let bytes = match chunk {
                Err(_) => break Outcome::transient("stalled", have > from),
                Ok(Err(e)) => break Outcome::transient(&describe(e), have > from),
                Ok(Ok(None)) if have < item.size => {
                    break Outcome::transient("the connection ended early", have > from);
                }
                Ok(Ok(None)) => {
                    break if partial.matches(&item.digest) {
                        Outcome::Complete {
                            transferred: have - from,
                        }
                    } else {
                        Outcome::Mismatch { resumed }
                    };
                }
                Ok(Ok(Some(bytes))) => bytes,
            };
            if have + bytes.len() as u64 > item.size {
                break Outcome::Mismatch { resumed };
            }
            writer.write_all(&bytes).await.map_err(io)?;
            partial.update(&bytes);
            have += bytes.len() as u64;
            progress(have, item.size);
        };
        writer.flush().await.map_err(io)?;
        Ok(outcome)
    }
}

enum Outcome {
    Complete {
        transferred: u64,
    },
    /// The bytes do not match the digest or the size. `resumed`: some came before this request.
    Mismatch {
        resumed: bool,
    },
    /// A 4xx: this URL will not serve the file.
    Refused(String),
    /// Worth another try. `progressed`: bytes arrived before it dropped.
    Transient {
        reason: String,
        progressed: bool,
    },
    SourceChanged,
}

impl Outcome {
    fn transient(reason: &str, progressed: bool) -> Outcome {
        Outcome::Transient {
            reason: reason.to_string(),
            progressed,
        }
    }
}

/// The digest of the first `len` bytes of the part file.
struct Partial {
    hasher: Hasher,
    len: u64,
}

impl Partial {
    fn new(digest: &Digest) -> Partial {
        Partial {
            hasher: Hasher::new(digest),
            len: 0,
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        self.hasher.update(bytes);
        self.len += bytes.len() as u64;
    }

    fn matches(&self, digest: &Digest) -> bool {
        self.hasher.hex() == expected_hex(digest)
    }
}

#[derive(Clone)]
enum Hasher {
    Sha256(sha2::Sha256),
    Md5(md5::Md5),
}

impl Hasher {
    fn new(digest: &Digest) -> Hasher {
        match digest {
            Digest::Sha256(_) => Hasher::Sha256(sha2::Sha256::new()),
            Digest::Md5(_) => Hasher::Md5(md5::Md5::new()),
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        match self {
            Hasher::Sha256(h) => h.update(bytes),
            Hasher::Md5(h) => h.update(bytes),
        }
    }

    fn hex(&self) -> String {
        let bytes = match self.clone() {
            Hasher::Sha256(h) => h.finalize().to_vec(),
            Hasher::Md5(h) => h.finalize().to_vec(),
        };
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

fn expected_hex(digest: &Digest) -> &str {
    match digest {
        Digest::Sha256(hex) | Digest::Md5(hex) => hex,
    }
}

/// Hashes the first `len` bytes of `path`.
async fn hash_file(
    path: &Path,
    len: u64,
    digest: &Digest,
    cancel: &CancellationToken,
) -> Result<Partial, DownloadError> {
    let mut partial = Partial::new(digest);
    if len == 0 {
        return Ok(partial);
    }
    let mut file = tokio::fs::File::open(path).await.map_err(io)?;
    let mut buffer = vec![0; 1024 * 1024];
    while partial.len < len {
        if cancel.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        let want = buffer.len().min((len - partial.len) as usize);
        let n = file.read(&mut buffer[..want]).await.map_err(io)?;
        if n == 0 {
            return Err(DownloadError::Io(format!(
                "{} ended at {} of {len} bytes",
                path.display(),
                partial.len
            )));
        }
        partial.update(&buffer[..n]);
    }
    Ok(partial)
}

/// Resolves when the download source changes; never once the setting is gone.
async fn source_changed(source: &mut watch::Receiver<DownloadSource>) {
    if source.changed().await.is_err() {
        std::future::pending::<()>().await;
    }
}

async fn file_len(path: &Path) -> Result<Option<u64>, DownloadError> {
    match tokio::fs::metadata(path).await {
        Ok(meta) => Ok(Some(meta.len())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io(e)),
    }
}

async fn truncate(path: &Path, len: u64) -> Result<(), DownloadError> {
    let file = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .await
        .map_err(io)?;
    file.set_len(len).await.map_err(io)
}

async fn remove(path: &Path) -> Result<(), DownloadError> {
    match tokio::fs::remove_file(path).await {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io(e)),
        _ => Ok(()),
    }
}

fn io(e: std::io::Error) -> DownloadError {
    DownloadError::Io(e.to_string())
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| "an unreadable URL".into())
}

/// The error and its causes, which say what actually failed (refused, reset, TLS, DNS).
fn describe(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut text = error.to_string();
    let mut cause = std::error::Error::source(&error);
    while let Some(e) = cause {
        text.push_str(": ");
        text.push_str(&e.to_string());
        cause = e.source();
    }
    text
}
