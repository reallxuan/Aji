//! KataGo's analysis engine for Aji.
//!
//! The protocol layer is pure: it builds queries, classifies KataGo's output lines, and
//! throttles and caches the updates. [`Engine`] runs KataGo itself: an actor that spawns the
//! process, owns the state machine and the watchdog, and makes sure KataGo never outlives
//! Aji.

mod cache;
mod engine;
mod process;
mod query;
mod response;
mod state;
mod throttle;
mod update;

pub use cache::*;
pub use engine::*;
pub use process::{
    EngineFiles, LaunchSpec, MAX_RUN_STDOUT, RunLimits, RunOutput, katago_benchmark_launch,
    katago_launch, run_to_end,
};
pub use query::*;
pub use response::*;
pub use state::*;
pub use throttle::*;
pub use update::*;
