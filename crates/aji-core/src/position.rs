//! A position (setup stones plus a move list) and its stable key.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

use crate::coords::{BoardSize, Color, CoreError, Komi, Move, Point, Rules};

/// A 64-bit position hash, written as 16 lowercase hex digits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, TS)]
#[ts(type = "string", export)]
pub struct PositionKey(pub u64);

impl fmt::Display for PositionKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:016x}", self.0)
    }
}

impl Serialize for PositionKey {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for PositionKey {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        let valid = s.len() == 16 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
        if !valid {
            return Err(serde::de::Error::custom("expected 16 lowercase hex digits"));
        }
        u64::from_str_radix(&s, 16)
            .map(PositionKey)
            .map_err(serde::de::Error::custom)
    }
}

/// A board position: size, rules, komi, setup stones and the moves played after them.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Position {
    pub size: BoardSize,
    pub rules: Rules,
    pub komi: Komi,
    pub setup: Vec<(Color, Point)>,
    pub moves: Vec<(Color, Move)>,
}

fn color_byte(c: Color) -> u8 {
    match c {
        Color::Black => 0,
        Color::White => 1,
    }
}

fn rules_byte(r: Rules) -> u8 {
    match r {
        Rules::Chinese => 0,
        Rules::Japanese => 1,
        Rules::Korean => 2,
        Rules::TrompTaylor => 3,
    }
}

impl Position {
    pub fn empty(size: BoardSize, rules: Rules, komi: Komi) -> Position {
        Position {
            size,
            rules,
            komi,
            setup: Vec::new(),
            moves: Vec::new(),
        }
    }

    /// Checks that every point lies on the board.
    pub fn validate(&self) -> Result<(), CoreError> {
        let n = self.size.get();
        let check = |p: Point| {
            if p.x < n && p.y < n {
                Ok(())
            } else {
                Err(CoreError::PointOffBoard(p))
            }
        };
        for &(_, p) in &self.setup {
            check(p)?;
        }
        for &(_, mv) in &self.moves {
            if let Move::Play(p) = mv {
                check(p)?;
            }
        }
        Ok(())
    }

    /// FNV-1a 64 over a fixed encoding; setup stones are sorted by `(y, x, color)`.
    pub fn key(&self) -> PositionKey {
        let mut buf = vec![self.size.get(), rules_byte(self.rules)];
        buf.extend_from_slice(&self.komi.half_points().to_le_bytes());

        let mut setup: Vec<(u8, u8, u8)> = self
            .setup
            .iter()
            .map(|&(c, p)| (p.y, p.x, color_byte(c)))
            .collect();
        setup.sort_unstable();
        buf.extend_from_slice(&(setup.len() as u16).to_le_bytes());
        for (y, x, c) in setup {
            buf.extend_from_slice(&[c, x, y]);
        }

        buf.extend_from_slice(&(self.moves.len() as u16).to_le_bytes());
        for &(c, mv) in &self.moves {
            buf.push(color_byte(c));
            match mv {
                Move::Play(p) => buf.extend_from_slice(&[p.x, p.y]),
                Move::Pass => buf.extend_from_slice(&[0xFF, 0xFF]),
            }
        }

        let mut h: u64 = 0xcbf29ce484222325;
        for b in buf {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x100000001b3);
        }
        PositionKey(h)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coords::move_from_gtp;

    fn gtp(s: &str) -> Point {
        match move_from_gtp(s, BoardSize::NINETEEN).unwrap() {
            Move::Play(p) => p,
            Move::Pass => unreachable!(),
        }
    }

    fn pos(rules: Rules, komi: f64) -> Position {
        Position::empty(BoardSize::NINETEEN, rules, Komi::new(komi).unwrap())
    }

    #[test]
    fn position_key_is_pinned() {
        let key = |p: &Position| p.key().to_string();
        assert_eq!(key(&pos(Rules::Chinese, 7.5)), "4d325c64abd378a1");
        assert_eq!(key(&pos(Rules::Chinese, 6.5)), "065f24ca87b70513");
        assert_eq!(key(&pos(Rules::Japanese, 7.5)), "e6fe7ebd69fca626");

        let mut a = pos(Rules::Chinese, 7.5);
        a.moves = vec![
            (Color::Black, Move::Play(gtp("Q16"))),
            (Color::White, Move::Play(gtp("D4"))),
        ];
        assert_eq!(key(&a), "f588b40db0c2ff10");

        let mut b = pos(Rules::Chinese, 7.5);
        b.moves = vec![
            (Color::White, Move::Play(gtp("D4"))),
            (Color::Black, Move::Play(gtp("Q16"))),
        ];
        assert_eq!(key(&b), "7b7a98bb0b960a1a");

        let mut c = pos(Rules::Chinese, 7.5);
        c.moves = vec![(Color::Black, Move::Pass)];
        assert_eq!(key(&c), "af9ffa44758edc9e");

        let mut d = pos(Rules::Chinese, 0.5);
        d.setup = vec![(Color::Black, gtp("D4")), (Color::Black, gtp("Q16"))];
        assert_eq!(key(&d), "87ca92a0a8996f5d");
    }

    #[test]
    fn setup_order_does_not_change_the_key() {
        let mut a = pos(Rules::Chinese, 0.5);
        a.setup = vec![(Color::Black, gtp("D4")), (Color::White, gtp("Q16"))];
        let mut b = a.clone();
        b.setup.reverse();
        assert_eq!(a.key(), b.key());
    }

    #[test]
    fn position_key_serialises_as_hex_string() {
        let k = pos(Rules::Chinese, 7.5).key();
        assert_eq!(serde_json::to_string(&k).unwrap(), "\"4d325c64abd378a1\"");
        assert_eq!(
            serde_json::from_str::<PositionKey>("\"4d325c64abd378a1\"").unwrap(),
            k
        );
    }

    #[test]
    fn validate_rejects_off_board() {
        let mut p = pos(Rules::Chinese, 7.5);
        assert!(p.validate().is_ok());
        p.moves = vec![(Color::Black, Move::Play(Point { x: 19, y: 0 }))];
        assert!(matches!(p.validate(), Err(CoreError::PointOffBoard(_))));
    }
}
