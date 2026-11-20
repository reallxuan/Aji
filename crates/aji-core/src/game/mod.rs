//! A playable game built from an SGF tree: the board rules, the game tree and the positions
//! sent to KataGo.

mod board;
mod record;
mod rules;

pub use board::*;
pub use record::*;
pub use rules::*;
