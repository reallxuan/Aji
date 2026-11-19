//! Colours, points, moves, GTP coordinates, rules and komi.

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Columns of GTP coordinates, left to right. There is no `I`.
const GTP_COLUMNS: &[u8] = b"ABCDEFGHJKLMNOPQRST";

/// Errors raised while building or checking core types.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum CoreError {
    BoardSizeOutOfRange(u8),
    KomiInvalid,
    PointOffBoard(Point),
    BadCoordinate(String),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BoardSizeOutOfRange(n) => write!(f, "board size {n} is outside 2..=19"),
            Self::KomiInvalid => write!(f, "komi must be a multiple of 0.5 within [-400, 400]"),
            Self::PointOffBoard(p) => write!(f, "point ({}, {}) is off the board", p.x, p.y),
            Self::BadCoordinate(s) => write!(f, "bad coordinate {s:?}"),
        }
    }
}

impl std::error::Error for CoreError {}

/// A stone colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Color {
    Black,
    White,
}

impl Color {
    pub fn opponent(self) -> Color {
        match self {
            Color::Black => Color::White,
            Color::White => Color::Black,
        }
    }

    /// The GTP colour letter.
    pub fn gtp(self) -> &'static str {
        match self {
            Color::Black => "B",
            Color::White => "W",
        }
    }
}

/// The side of a square board, 2 to 19 (KataGo's limit).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct BoardSize(u8);

impl BoardSize {
    pub const NINETEEN: BoardSize = BoardSize(19);

    pub fn new(n: u8) -> Result<BoardSize, CoreError> {
        if (2..=19).contains(&n) {
            Ok(BoardSize(n))
        } else {
            Err(CoreError::BoardSizeOutOfRange(n))
        }
    }

    pub fn get(self) -> u8 {
        self.0
    }
}

impl TryFrom<u8> for BoardSize {
    type Error = CoreError;
    fn try_from(n: u8) -> Result<Self, CoreError> {
        BoardSize::new(n)
    }
}

impl From<BoardSize> for u8 {
    fn from(s: BoardSize) -> u8 {
        s.0
    }
}

/// A board point. (0,0) is the top-left corner; x grows rightwards, y downwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Point {
    pub x: u8,
    pub y: u8,
}

/// A move: a stone placed on a point, or a pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(export)]
pub enum Move {
    Play(Point),
    Pass,
}

/// Formats a move as a GTP vertex, for example `Q16` or `pass`. A point off the board gives
/// `PointOffBoard`.
pub fn move_to_gtp(mv: Move, size: BoardSize) -> Result<String, CoreError> {
    match mv {
        Move::Pass => Ok("pass".to_string()),
        Move::Play(p) if p.x < size.get() && p.y < size.get() => Ok(format!(
            "{}{}",
            GTP_COLUMNS[usize::from(p.x)] as char,
            size.get() - p.y
        )),
        Move::Play(p) => Err(CoreError::PointOffBoard(p)),
    }
}

/// Parses a GTP vertex, ignoring case. The `(x,y)` form is not supported.
pub fn move_from_gtp(s: &str, size: BoardSize) -> Result<Move, CoreError> {
    let bad = || CoreError::BadCoordinate(s.to_string());
    if s.eq_ignore_ascii_case("pass") {
        return Ok(Move::Pass);
    }
    let (&col, row) = s.as_bytes().split_first().ok_or_else(bad)?;
    let x = GTP_COLUMNS
        .iter()
        .position(|&c| c == col.to_ascii_uppercase())
        .filter(|&x| x < usize::from(size.get()))
        .ok_or_else(bad)?;
    if row.is_empty() || !row.iter().all(u8::is_ascii_digit) {
        return Err(bad());
    }
    let row: u8 = std::str::from_utf8(row)
        .map_err(|_| bad())?
        .parse()
        .map_err(|_| bad())?;
    if row < 1 || row > size.get() {
        return Err(bad());
    }
    Ok(Move::Play(Point {
        x: x as u8,
        y: size.get() - row,
    }))
}

/// Rule sets KataGo understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Rules {
    Chinese,
    Japanese,
    Korean,
    TrompTaylor,
}

impl Rules {
    /// The name KataGo's `rules` field expects.
    pub fn katago_name(self) -> &'static str {
        match self {
            Rules::Chinese => "chinese",
            Rules::Japanese => "japanese",
            Rules::Korean => "korean",
            Rules::TrompTaylor => "tromp-taylor",
        }
    }
}

/// Komi in points, stored as a count of half-points.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "f64", into = "f64")]
pub struct Komi(i16);

impl Komi {
    /// Accepts multiples of 0.5 in [-400, 400].
    pub fn new(points: f64) -> Result<Komi, CoreError> {
        let half = points * 2.0;
        if !half.is_finite() || half.fract() != 0.0 || half.abs() > 800.0 {
            return Err(CoreError::KomiInvalid);
        }
        Ok(Komi(half as i16))
    }

    pub fn points(self) -> f64 {
        f64::from(self.0) / 2.0
    }

    /// The komi as a count of half-points.
    pub(crate) fn half_points(self) -> i16 {
        self.0
    }
}

impl TryFrom<f64> for Komi {
    type Error = CoreError;
    fn try_from(points: f64) -> Result<Self, CoreError> {
        Komi::new(points)
    }
}

impl From<Komi> for f64 {
    fn from(k: Komi) -> f64 {
        k.points()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: u8, y: u8) -> Point {
        Point { x, y }
    }

    #[test]
    fn gtp_round_trip() {
        let n19 = BoardSize::NINETEEN;
        let n9 = BoardSize::new(9).unwrap();
        let cases = [
            (p(0, 0), "A19", n19),
            (p(18, 18), "T1", n19),
            (p(8, 0), "J19", n19),
            (p(15, 3), "Q16", n19),
            (p(4, 4), "E5", n9),
        ];
        for (pt, s, size) in cases {
            assert_eq!(move_to_gtp(Move::Play(pt), size).unwrap(), s);
            assert_eq!(move_from_gtp(s, size).unwrap(), Move::Play(pt));
        }
        for s in ["pass", "PASS", "Pass"] {
            assert_eq!(move_from_gtp(s, n19).unwrap(), Move::Pass);
        }
        assert_eq!(move_to_gtp(Move::Pass, n19).unwrap(), "pass");
    }

    #[test]
    fn gtp_rejects_off_board_points() {
        let n19 = BoardSize::NINETEEN;
        let n9 = BoardSize::new(9).unwrap();
        for (pt, size) in [(p(19, 0), n19), (p(0, 19), n19), (p(9, 0), n9)] {
            assert_eq!(
                move_to_gtp(Move::Play(pt), size),
                Err(CoreError::PointOffBoard(pt))
            );
        }
    }

    #[test]
    fn gtp_rejects() {
        let n19 = BoardSize::NINETEEN;
        let n9 = BoardSize::new(9).unwrap();
        for (s, size) in [
            ("i5", n9),
            ("T19", n9),
            ("A0", n19),
            ("A20", n19),
            ("", n19),
            ("(0,13)", n19),
        ] {
            assert!(
                matches!(move_from_gtp(s, size), Err(CoreError::BadCoordinate(_))),
                "{s:?} should be rejected"
            );
        }
    }

    #[test]
    fn board_size_range() {
        assert!(BoardSize::new(1).is_err());
        assert!(BoardSize::new(20).is_err());
        assert_eq!(BoardSize::new(2).unwrap().get(), 2);
        assert_eq!(BoardSize::new(19).unwrap().get(), 19);
    }

    #[test]
    fn komi_validation() {
        for ok in [7.5, -7.5, 0.0, 400.0] {
            assert_eq!(Komi::new(ok).unwrap().points(), ok);
        }
        for bad in [7.25, 400.5, f64::NAN] {
            assert!(Komi::new(bad).is_err(), "{bad} should be rejected");
        }
        let k: Komi = serde_json::from_str("7.5").unwrap();
        assert_eq!(k, Komi::new(7.5).unwrap());
        assert_eq!(serde_json::to_string(&k).unwrap(), "7.5");
    }

    #[test]
    fn move_json_shape() {
        let play = Move::Play(p(15, 3));
        let json = serde_json::to_value(play).unwrap();
        assert_eq!(json, serde_json::json!({"type": "play", "x": 15, "y": 3}));
        assert_eq!(serde_json::from_value::<Move>(json).unwrap(), play);
        let pass = serde_json::to_value(Move::Pass).unwrap();
        assert_eq!(pass, serde_json::json!({"type": "pass"}));
    }
}
