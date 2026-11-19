//! Pure game types for Aji: colours, points, moves, GTP coordinates and positions.
//! No I/O, no async, no OS calls.

mod coords;
mod position;

pub use coords::*;
pub use position::*;
