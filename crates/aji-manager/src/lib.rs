//! Aji's engine manager. It depends on no other crate in the workspace.

pub mod hardware;
pub mod manifest;
pub mod recommend;

pub use hardware::OsKind;
