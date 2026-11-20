//! The board: stones, captures, suicide and the simple-ko point.

use serde::Serialize;
use ts_rs::TS;

use crate::coords::{BoardSize, Color, Move, Point};

/// Why a move in a file breaks the rules. The move is still played (design 5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Illegal {
    /// The point already held a stone; the new stone replaced it.
    Occupied,
    /// The stone had no liberties after captures; it was taken off again.
    Suicide,
    /// An immediate recapture of a simple ko.
    Ko,
}

/// What a move did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayResult {
    pub captured: Vec<Point>,
    pub illegal: Option<Illegal>,
}

/// A square board with its stones, the simple-ko point and the capture counts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Board {
    size: BoardSize,
    cells: Vec<Option<Color>>,
    /// The point a colour may not play at next, after a single-stone ko capture.
    ko: Option<(Point, Color)>,
    /// Stones captured by Black, by White.
    captures: (u32, u32),
}

impl Board {
    pub fn new(size: BoardSize) -> Board {
        let n = usize::from(size.get());
        Board {
            size,
            cells: vec![None; n * n],
            ko: None,
            captures: (0, 0),
        }
    }

    pub fn size(&self) -> BoardSize {
        self.size
    }

    fn index(&self, p: Point) -> Option<usize> {
        let n = self.size.get();
        (p.x < n && p.y < n).then(|| usize::from(p.y) * usize::from(n) + usize::from(p.x))
    }

    /// The stone at `p`; `None` when empty or off the board.
    pub fn get(&self, p: Point) -> Option<Color> {
        self.index(p).and_then(|i| self.cells[i])
    }

    /// Places or removes a setup stone. Clears the ko point. Off-board points are ignored.
    pub fn set(&mut self, p: Point, stone: Option<Color>) {
        if let Some(i) = self.index(p) {
            self.cells[i] = stone;
        }
        self.ko = None;
    }

    /// Every point, row by row (`y * size + x`).
    pub fn stones(&self) -> Vec<Option<Color>> {
        self.cells.clone()
    }

    /// Stones captured by Black and by White.
    pub fn captures(&self) -> (u32, u32) {
        self.captures
    }

    fn neighbours(&self, p: Point) -> impl Iterator<Item = Point> + use<> {
        let n = self.size.get();
        let (x, y) = (p.x, p.y);
        [
            (x > 0).then(|| Point { x: x - 1, y }),
            (x + 1 < n).then(|| Point { x: x + 1, y }),
            (y > 0).then(|| Point { x, y: y - 1 }),
            (y + 1 < n).then(|| Point { x, y: y + 1 }),
        ]
        .into_iter()
        .flatten()
    }

    /// The group at `p` and whether it has a liberty.
    fn group(&self, p: Point) -> (Vec<Point>, bool) {
        let Some(color) = self.get(p) else {
            return (Vec::new(), true);
        };
        let mut seen = vec![false; self.cells.len()];
        let mut stack = vec![p];
        let mut group = Vec::new();
        let mut free = false;
        seen[self.index(p).expect("on the board")] = true;
        while let Some(q) = stack.pop() {
            group.push(q);
            for r in self.neighbours(q) {
                let i = self.index(r).expect("a neighbour is on the board");
                match self.cells[i] {
                    None => free = true,
                    Some(c) if c == color && !seen[i] => {
                        seen[i] = true;
                        stack.push(r);
                    }
                    Some(_) => {}
                }
            }
        }
        (group, free)
    }

    fn remove(&mut self, points: &[Point]) {
        for &p in points {
            if let Some(i) = self.index(p) {
                self.cells[i] = None;
            }
        }
    }

    fn credit(&mut self, color: Color, count: usize) {
        let count = u32::try_from(count).unwrap_or(u32::MAX);
        match color {
            Color::Black => self.captures.0 += count,
            Color::White => self.captures.1 += count,
        }
    }

    /// Plays `mv` for `color`. An illegal move is flagged and still played as far as it can be:
    /// a stone on an occupied point replaces it, a ko recapture captures, and a forbidden
    /// suicide is taken back so the board is unchanged.
    pub fn play(&mut self, color: Color, mv: Move, multi_stone_suicide: bool) -> PlayResult {
        let Move::Play(p) = mv else {
            self.ko = None;
            return PlayResult {
                captured: Vec::new(),
                illegal: None,
            };
        };
        let Some(i) = self.index(p) else {
            return PlayResult {
                captured: Vec::new(),
                illegal: Some(Illegal::Occupied),
            };
        };
        let mut illegal = None;
        if self.cells[i].is_some() {
            illegal = Some(Illegal::Occupied);
        } else if self.ko == Some((p, color)) {
            illegal = Some(Illegal::Ko);
        }
        let before = self.clone();
        self.cells[i] = Some(color);

        let mut captured = Vec::new();
        for q in self.neighbours(p) {
            if self.get(q) == Some(color.opponent()) {
                let (group, free) = self.group(q);
                if !free {
                    self.remove(&group);
                    captured.extend(group);
                }
            }
        }
        self.credit(color, captured.len());

        let (own, free) = self.group(p);
        if !free {
            if own.len() > 1 && multi_stone_suicide {
                self.remove(&own);
                self.credit(color.opponent(), own.len());
            } else if illegal.is_none() {
                *self = before;
                self.ko = None;
                return PlayResult {
                    captured: Vec::new(),
                    illegal: Some(Illegal::Suicide),
                };
            }
        }

        self.ko = None;
        if captured.len() == 1 && own.len() == 1 {
            let liberties = self
                .neighbours(p)
                .filter(|&q| self.get(q).is_none())
                .count();
            if liberties == 1 {
                self.ko = Some((captured[0], color.opponent()));
            }
        }
        PlayResult { captured, illegal }
    }
}

/// The points an SGF point value names: one point (`pd`) or a rectangle (`aa:cc`). A malformed
/// or off-board value gives none.
pub fn expand_points(value: &str, size: BoardSize) -> Vec<Point> {
    let parse = |s: &str| -> Option<Point> {
        let b = s.as_bytes();
        if b.len() != 2 || !b.iter().all(u8::is_ascii_lowercase) {
            return None;
        }
        let p = Point {
            x: b[0] - b'a',
            y: b[1] - b'a',
        };
        (p.x < size.get() && p.y < size.get()).then_some(p)
    };
    match value.split_once(':') {
        None => parse(value).into_iter().collect(),
        Some((a, b)) => {
            let (Some(a), Some(b)) = (parse(a), parse(b)) else {
                return Vec::new();
            };
            let mut out = Vec::new();
            for y in a.y.min(b.y)..=a.y.max(b.y) {
                for x in a.x.min(b.x)..=a.x.max(b.x) {
                    out.push(Point { x, y });
                }
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(s: &str) -> Point {
        let b = s.as_bytes();
        Point {
            x: b[0] - b'a',
            y: b[1] - b'a',
        }
    }

    fn board9() -> Board {
        Board::new(BoardSize::new(9).unwrap())
    }

    fn play(b: &mut Board, c: Color, s: &str) -> PlayResult {
        b.play(c, Move::Play(pt(s)), false)
    }

    use Color::{Black as B, White as W};

    #[test]
    fn captures_a_group() {
        let mut b = board9();
        // White pair at b1-c1 ("ba","ca") on the edge; black surrounds.
        play(&mut b, W, "ba");
        play(&mut b, W, "ca");
        play(&mut b, B, "aa");
        play(&mut b, B, "bb");
        play(&mut b, B, "cb");
        let r = play(&mut b, B, "da");
        assert_eq!(r.illegal, None);
        let mut captured = r.captured.clone();
        captured.sort_by_key(|p| (p.y, p.x));
        assert_eq!(captured, [pt("ba"), pt("ca")]);
        assert_eq!(b.get(pt("ba")), None);
        assert_eq!(b.captures(), (2, 0));
    }

    #[test]
    fn single_stone_suicide_is_illegal() {
        let mut b = board9();
        play(&mut b, W, "ba");
        play(&mut b, W, "ab");
        let before = b.clone();
        let r = play(&mut b, B, "aa");
        assert_eq!(r.illegal, Some(Illegal::Suicide));
        assert_eq!(b, before);
    }

    #[test]
    fn multi_stone_suicide_when_allowed() {
        let mut b = board9();
        for s in ["ca", "cb", "ac", "bc"] {
            play(&mut b, W, s);
        }
        play(&mut b, B, "aa");
        play(&mut b, B, "ba");
        play(&mut b, B, "ab");
        let r = b.play(B, Move::Play(pt("bb")), true);
        assert_eq!(r.illegal, None);
        for s in ["aa", "ba", "ab", "bb"] {
            assert_eq!(b.get(pt(s)), None, "{s}");
        }
        assert_eq!(b.captures(), (0, 4));
    }

    /// A ko shape: black at b-a? Using the classic shape around c3/d3 on a 9x9 board.
    fn ko_board() -> Board {
        let mut b = board9();
        // Black: cb, bc, cd. White: db, ec, dd, and white at cc? Build: white stone at cc is
        // captured by black dc, leaving the ko at cc.
        for s in ["cb", "bc", "cd"] {
            play(&mut b, B, s);
        }
        for s in ["db", "ec", "dd", "cc"] {
            play(&mut b, W, s);
        }
        b
    }

    #[test]
    fn simple_ko() {
        let mut b = ko_board();
        let r = play(&mut b, B, "dc");
        assert_eq!(r.captured, [pt("cc")]);
        // White retakes at once: a ko violation, flagged but still played.
        let r = play(&mut b, W, "cc");
        assert_eq!(r.illegal, Some(Illegal::Ko));
        assert_eq!(r.captured, [pt("dc")]);
        assert_eq!(b.get(pt("cc")), Some(W));
    }

    #[test]
    fn ko_retake_after_a_move_elsewhere_is_legal() {
        let mut b = ko_board();
        play(&mut b, B, "dc");
        play(&mut b, W, "hh");
        play(&mut b, B, "gg");
        let r = play(&mut b, W, "cc");
        assert_eq!(r.illegal, None);
    }

    #[test]
    fn pass_clears_ko() {
        let mut b = ko_board();
        play(&mut b, B, "dc");
        b.play(W, Move::Pass, false);
        b.play(B, Move::Pass, false);
        assert_eq!(play(&mut b, W, "cc").illegal, None);
    }

    #[test]
    fn occupied_point_replaces_the_stone() {
        let mut b = board9();
        play(&mut b, B, "ee");
        let r = play(&mut b, W, "ee");
        assert_eq!(r.illegal, Some(Illegal::Occupied));
        assert_eq!(b.get(pt("ee")), Some(W));
    }

    #[test]
    fn set_places_and_removes_setup_stones() {
        let mut b = board9();
        b.set(pt("aa"), Some(B));
        assert_eq!(b.get(pt("aa")), Some(B));
        b.set(pt("aa"), None);
        assert_eq!(b.get(pt("aa")), None);
        assert_eq!(b.stones().len(), 81);
    }

    #[test]
    fn expands_points() {
        let n19 = BoardSize::NINETEEN;
        assert_eq!(expand_points("pd", n19), [pt("pd")]);
        assert_eq!(expand_points("aa:cc", n19).len(), 9);
        let mut a = expand_points("cc:aa", n19);
        let mut b = expand_points("aa:cc", n19);
        a.sort_by_key(|p| (p.y, p.x));
        b.sort_by_key(|p| (p.y, p.x));
        assert_eq!(a, b);
        assert!(expand_points("tt", n19).is_empty());
        assert!(expand_points("zz", n19).is_empty());
        assert!(expand_points("p", n19).is_empty());
        assert!(expand_points("jj", BoardSize::new(9).unwrap()).is_empty());
    }
}
