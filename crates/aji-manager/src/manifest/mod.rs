//! The install manifest: every KataGo engine, NVIDIA runtime set and network Aji can install.

mod schema;

pub use schema::*;

/// The manifest compiled into the binary, used when no fresher copy is available.
pub const BUNDLED: &[u8] = include_bytes!("../../manifest/manifest.json");
