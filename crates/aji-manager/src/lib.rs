//! Aji's engine manager: the manifest, hardware detection, the recommendation and the install
//! pipeline. It runs KataGo through `aji-engine`.

mod atomic;
pub mod hardware;
pub mod install;
pub mod manifest;
pub mod recommend;
pub mod setup;

pub use hardware::OsKind;
pub use setup::Setup;
