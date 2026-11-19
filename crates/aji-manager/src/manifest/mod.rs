//! The install manifest: every KataGo engine, NVIDIA runtime set and network Aji can install.

mod cache;
mod fetch;
mod keys;
mod schema;
mod select;
mod store;
mod verify;

pub use cache::{load_cache, store_cache};
pub use fetch::{ClientOptions, FetchError, MANIFEST_BASES, fetch, http_client};
pub use keys::{TRUSTED_KEYS, trusted_keys};
pub use schema::*;
pub use select::{Candidate, Rejection, Selected, Source, select};
pub use store::ManifestStore;
pub use verify::verify;

/// The manifest compiled into the binary, used when no fresher copy is available.
pub const BUNDLED: &[u8] = include_bytes!("../../manifest/manifest.json");
