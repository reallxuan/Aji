//! The manifest in use, refreshed from the network in the background.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use minisign_verify::PublicKey;

use super::{FetchError, Manifest, Selected, Source, fetch, load_cache, select, store_cache};

pub struct ManifestStore {
    bundled: &'static [u8],
    cache_dir: PathBuf,
    keys: Vec<PublicKey>,
    current: Mutex<Arc<Selected>>,
    /// Built by `fixed`: never fetches.
    fixed: bool,
}

impl ManifestStore {
    /// Selects from the bundled copy and the cache, without touching the network.
    pub fn open(bundled: &'static [u8], cache_dir: PathBuf, keys: Vec<PublicKey>) -> ManifestStore {
        let cached: Vec<_> = load_cache(&cache_dir).into_iter().collect();
        let current = Arc::new(select(bundled, cached, &keys));
        ManifestStore {
            bundled,
            cache_dir,
            keys,
            current: Mutex::new(current),
            fixed: false,
        }
    }

    /// Uses `manifest` as it is, as the bundled copy, and never fetches: `refresh` returns
    /// `Ok(Source::Bundled)`. For tests, whose manifests point at local `http://` servers that
    /// `parse_manifest`'s https rule would refuse.
    pub fn fixed(manifest: Manifest) -> ManifestStore {
        ManifestStore {
            bundled: &[],
            cache_dir: PathBuf::new(),
            keys: Vec::new(),
            current: Mutex::new(Arc::new(Selected::fixed(manifest))),
            fixed: true,
        }
    }

    pub fn current(&self) -> Arc<Selected> {
        self.current
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Fetches the published copy and selects again, with the copy in use as a rival. A fetched
    /// winner is cached and swapped in. Returns the source in use afterwards, or the fetch error,
    /// in which case nothing changes.
    ///
    /// The rival is the copy current when the fetch returns, not when it started, and the
    /// selection, the cache write and the swap happen under one lock. A slow refresh therefore
    /// never replaces a newer copy that a faster one swapped in meanwhile, and the cache on disk
    /// always holds the copy in use.
    pub async fn refresh(
        &self,
        client: &reqwest::Client,
        bases: &[&str],
    ) -> Result<Source, FetchError> {
        if self.fixed {
            return Ok(Source::Bundled);
        }
        let fetched = fetch(client, bases).await?;
        let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        let mut candidates: Vec<_> = current.candidate().cloned().into_iter().collect();
        candidates.push(fetched);
        let after = select(self.bundled, candidates, &self.keys);
        if after.source == Source::Fetched
            && let Some(candidate) = after.candidate()
        {
            // A cache that cannot be written costs only the next start-up's head start.
            let _ = store_cache(&self.cache_dir, candidate);
        }
        let source = after.source;
        *current = Arc::new(after);
        Ok(source)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::manifest::{BUNDLED, ClientOptions, http_client, parse_manifest};

    #[tokio::test]
    async fn a_fixed_store_never_fetches() {
        let mut manifest = parse_manifest(BUNDLED).unwrap();
        manifest.sequence = 7;
        let store = ManifestStore::fixed(manifest.clone());
        assert_eq!(store.current().manifest, manifest);
        assert_eq!(store.current().source, Source::Bundled);
        let options = ClientOptions {
            timeout: Some(Duration::from_secs(5)),
            connect_timeout: Duration::from_secs(5),
        };
        let client = http_client("Aji/test", options).unwrap();
        // Nothing listens on port 1: a fetch would fail.
        let source = store.refresh(&client, &["http://127.0.0.1:1"]).await;
        assert!(matches!(source, Ok(Source::Bundled)), "{source:?}");
        assert_eq!(store.current().manifest, manifest);
    }
}
