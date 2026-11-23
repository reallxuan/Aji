//! Pure game types for Aji: colours, points, moves, GTP coordinates and positions.
//! No I/O, no async, no OS calls.

mod coords;
pub mod game;
mod katarules;
mod position;
pub mod sgf;

pub use coords::*;
pub use katarules::*;
pub use position::*;
