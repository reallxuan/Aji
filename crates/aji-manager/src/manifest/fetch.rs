//! Downloading the published manifest and its signature.

use std::fmt;
use std::time::Duration;

use super::select::{Candidate, Source};

/// Where the signed manifest is published. A later entry is tried when an earlier one fails.
pub const MANIFEST_BASES: &[&str] = &["https://reallxuan.github.io/aji-manifest/v1"];

/// The largest body accepted, for the manifest and for its signature.
const MAX_BODY: usize = 4 * 1024 * 1024;

pub struct ClientOptions {
    /// The limit for one whole request, body included. `None` sets no limit, for downloads whose
    /// size makes any fixed limit wrong; their stalls are caught by the caller.
    pub timeout: Option<Duration>,
    /// The limit for opening the connection.
    pub connect_timeout: Duration,
}

impl Default for ClientOptions {
    /// The manifest's limits.
    fn default() -> Self {
        ClientOptions {
            timeout: Some(Duration::from_secs(10)),
            connect_timeout: Duration::from_secs(15),
        }
    }
}

/// Builds the HTTP client: rustls on the `ring` provider, the system proxy, and the given user
/// agent (`Aji/<version>`; it must carry no personal data). A user agent that is not a valid
/// header value, or a TLS setup that fails, is an error rather than a panic at launch.
pub fn http_client(
    user_agent: &str,
    options: ClientOptions,
) -> Result<reqwest::Client, FetchError> {
    // `Err` means a provider is already installed, which is what we want.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .connect_timeout(options.connect_timeout);
    if let Some(timeout) = options.timeout {
        builder = builder.timeout(timeout);
    }
    builder
        .build()
        .map_err(|e| FetchError::Client(e.to_string()))
}

#[derive(Debug)]
pub enum FetchError {
    /// The HTTP client could not be built.
    Client(String),
    /// No base URL was given.
    NoBases,
    /// The request failed, timed out or the connection broke.
    Request(String),
    Status(u16),
    TooLarge,
    NotText,
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FetchError::Client(m) => write!(f, "cannot set up the HTTP client: {m}"),
            FetchError::NoBases => write!(f, "no manifest URL to fetch"),
            FetchError::Request(m) => write!(f, "request failed: {m}"),
            FetchError::Status(s) => write!(f, "the server answered {s}"),
            FetchError::TooLarge => write!(f, "the body is over {MAX_BODY} bytes"),
            FetchError::NotText => write!(f, "the signature is not text"),
        }
    }
}

impl std::error::Error for FetchError {}

async fn get(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, FetchError> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| FetchError::Request(e.to_string()))?;
    if !response.status().is_success() {
        return Err(FetchError::Status(response.status().as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err(FetchError::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| FetchError::Request(e.to_string()))?
    {
        if body.len() + chunk.len() > MAX_BODY {
            return Err(FetchError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn fetch_from(client: &reqwest::Client, base: &str) -> Result<Candidate, FetchError> {
    let base = base.trim_end_matches('/');
    let bytes = get(client, &format!("{base}/manifest.json")).await?;
    let signature = get(client, &format!("{base}/manifest.json.minisig")).await?;
    let signature = String::from_utf8(signature).map_err(|_| FetchError::NotText)?;
    Ok(Candidate {
        bytes,
        signature: Some(signature),
        source: Source::Fetched,
    })
}

/// Fetches `manifest.json` and `manifest.json.minisig` from the first base that serves both.
/// Any failure moves on to the next base; the last error is returned if none works.
pub async fn fetch(client: &reqwest::Client, bases: &[&str]) -> Result<Candidate, FetchError> {
    let mut last = FetchError::NoBases;
    for base in bases {
        match fetch_from(client, base).await {
            Ok(candidate) => return Ok(candidate),
            Err(e) => last = e,
        }
    }
    Err(last)
}
