//! A position (setup stones plus a move list) and its stable key.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

use crate::KataRules;
use crate::coords::{BoardSize, Color, CoreError, Komi, Move, Point};

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
    pub rules: KataRules,
    pub komi: Komi,
    pub setup: Vec<(Color, Point)>,
    pub moves: Vec<(Color, Move)>,
    /// Who moves first, when not Black: sent as KataGo's `initialPlayer` (handicap games, `PL`,
    /// and positions re-based on setup stones).
    pub initial_player: Option<Color>,
}

fn color_byte(c: Color) -> u8 {
    match c {
        Color::Black => 0,
        Color::White => 1,
    }
}

impl Position {
    pub fn empty(size: BoardSize, rules: KataRules, komi: Komi) -> Position {
        Position {
            size,
            rules,
            komi,
            setup: Vec::new(),
            moves: Vec::new(),
            initial_player: None,
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
    ///
    /// The rules are encoded as KataGo's full rule set (P2 M2 design 5.2), so presets KataGo
    /// plays identically (Japanese and Korean) share a key.
    pub fn key(&self) -> PositionKey {
        let mut buf = vec![self.size.get()];
        buf.extend_from_slice(&self.rules.key_bytes());
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

        // Appended only when set, so every key from before this field stays the same.
        if let Some(c) = self.initial_player {
            buf.extend_from_slice(&[0xFE, color_byte(c)]);
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
    use crate::coords::{Rules, move_from_gtp};

    fn gtp(s: &str) -> Point {
        match move_from_gtp(s, BoardSize::NINETEEN).unwrap() {
            Move::Play(p) => p,
            Move::Pass => unreachable!(),
        }
    }

    fn pos(rules: Rules, komi: f64) -> Position {
        Position::empty(BoardSize::NINETEEN, rules.into(), Komi::new(komi).unwrap())
    }

    #[test]
    fn existing_position_keys_are_unchanged() {
        let key = |p: &Position| p.key().to_string();
        assert_eq!(key(&pos(Rules::Chinese, 7.5)), "3edba656b924370b");
        assert_eq!(key(&pos(Rules::Chinese, 6.5)), "85aeddf0dd40aa99");
        assert_eq!(key(&pos(Rules::Japanese, 7.5)), "a9bd7c8039acb66b");

        let mut a = pos(Rules::Chinese, 7.5);
        a.moves = vec![
            (Color::Black, Move::Play(gtp("Q16"))),
            (Color::White, Move::Play(gtp("D4"))),
        ];
        assert_eq!(key(&a), "0631f691b6b52f7e");

        let mut b = pos(Rules::Chinese, 7.5);
        b.moves = vec![
            (Color::White, Move::Play(gtp("D4"))),
            (Color::Black, Move::Play(gtp("Q16"))),
        ];
        assert_eq!(key(&b), "f0ae3d5b10b0ad50");

        let mut c = pos(Rules::Chinese, 7.5);
        c.moves = vec![(Color::Black, Move::Pass)];
        assert_eq!(key(&c), "6a28c8fef62a396c");

        let mut d = pos(Rules::Chinese, 0.5);
        d.setup = vec![(Color::Black, gtp("D4")), (Color::Black, gtp("Q16"))];
        assert_eq!(key(&d), "a915f2e29a4e2c87");
    }

    #[test]
    fn key_is_pinned_by_a_test_vector() {
        let mut a = pos(Rules::Chinese, 7.5);
        a.moves = vec![
            (Color::Black, Move::Play(gtp("Q16"))),
            (Color::White, Move::Play(gtp("D4"))),
        ];
        assert_eq!(a.key().to_string(), "0631f691b6b52f7e");
    }

    #[test]
    fn japanese_and_korean_keys_differ_only_if_their_rules_do() {
        use crate::KataRules;
        let same = KataRules::from(Rules::Japanese) == KataRules::from(Rules::Korean);
        let keys_equal = pos(Rules::Japanese, 6.5).key() == pos(Rules::Korean, 6.5).key();
        assert_eq!(same, keys_equal);
        assert!(keys_equal);
    }

    #[test]
    fn komi_and_rules_still_change_the_key() {
        assert_ne!(
            pos(Rules::Chinese, 7.5).key(),
            pos(Rules::Chinese, 6.5).key()
        );
        assert_ne!(
            pos(Rules::Chinese, 7.5).key(),
            pos(Rules::Japanese, 7.5).key()
        );
        assert_ne!(
            pos(Rules::Chinese, 7.5).key(),
            pos(Rules::TrompTaylor, 7.5).key()
        );
    }

    #[test]
    fn initial_player_changes_the_key_only_when_set() {
        let mut p = pos(Rules::Chinese, 7.5);
        assert_eq!(p.initial_player, None);
        assert_eq!(p.key().to_string(), "3edba656b924370b");
        p.initial_player = Some(Color::White);
        assert_ne!(p.key().to_string(), "3edba656b924370b");
        let mut q = p.clone();
        q.initial_player = Some(Color::Black);
        assert_ne!(p.key(), q.key());
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
        assert_eq!(serde_json::to_string(&k).unwrap(), "\"3edba656b924370b\"");
        assert_eq!(
            serde_json::from_str::<PositionKey>("\"3edba656b924370b\"").unwrap(),
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
