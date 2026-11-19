//! Aji's engine manager. It depends on no other crate in the workspace.

pub mod hardware;
pub mod manifest;
pub mod recommend;
pub mod setup;

pub use hardware::OsKind;
pub use setup::Setup;
