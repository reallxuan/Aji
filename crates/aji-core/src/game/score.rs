//! Counting a position: the estimate from KataGo's ownership, and final scoring with dead stones
//! marked by hand (P2 M2 design 5.7 and 5.8).

use serde::Serialize;
use ts_rs::TS;

use super::Board;
use crate::{Color, Komi, Point, ScoringRule};

/// One side's count.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScoreSide {
    /// Live stones on the board.
    pub stones: u32,
    /// Empty points in this side's area.
    pub territory: u32,
    /// The opponent's dead stones inside this side's area.
    pub dead: u32,
    /// Stones this side captured during the game.
    pub prisoners: u32,
    /// The side's total, komi included for White.
    pub total: f64,
}

/// A count of the whole board.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Score {
    pub black: ScoreSide,
    pub white: ScoreSide,
    pub komi: f64,
    /// Black's total minus White's; positive means Black wins.
    pub margin: f64,
    /// Each point's owner, row by row, after dead stones are removed.
    pub owners: Vec<Option<Color>>,
    /// Final scoring gave some point of an open region (one touching both colours) to a side by
    /// KataGo's ownership: the game was not played out.
    pub open_by_ownership: bool,
}

/// Quantised ownership at or past which a point counts as settled (the 0.6 rule: 0.6 × 127).
pub const SETTLED: i8 = 76;

/// The stones connected to the one at `at`; empty when `at` is empty.
pub fn group_of(board: &Board, at: Point) -> Vec<Point> {
    let Some(color) = board.get(at) else {
        return Vec::new();
    };
    let n = board.size().get();
    let mut seen = vec![false; usize::from(n) * usize::from(n)];
    seen[index(n, at)] = true;
    let (mut out, mut stack) = (Vec::new(), vec![at]);
    while let Some(p) = stack.pop() {
        out.push(p);
        for q in neighbours(n, p) {
            if !seen[index(n, q)] && board.get(q) == Some(color) {
                seen[index(n, q)] = true;
                stack.push(q);
            }
        }
    }
    out
}

/// Stones whose ownership is settled for the other colour.
pub fn suggested_dead(board: &Board, ownership: &[i8]) -> Vec<Point> {
    points(board.size().get())
        .filter(|&p| {
            let v = ownership
                .get(index(board.size().get(), p))
                .copied()
                .unwrap_or(0);
            match board.get(p) {
                Some(Color::Black) => v <= -SETTLED,
                Some(Color::White) => v >= SETTLED,
                None => false,
            }
        })
        .collect()
}

/// Final scoring: regions are flood-filled after removing `dead`; a region bordered only by one
/// colour's live stones is that colour's. Any other region is open (dame, or a game not played
/// out): with `ownership` (Black's view) each of its points settled for a side (the 0.6 rule) is
/// that side's, the rest neutral; without it the whole region is neutral.
pub fn final_score(
    board: &Board,
    dead: &[Point],
    ownership: Option<&[i8]>,
    scoring: ScoringRule,
    komi: Komi,
    captures: (u32, u32),
) -> Score {
    let n = board.size().get();
    let live = live_stones(board, dead);
    let mut owners = live.clone();
    let mut seen = vec![false; live.len()];
    let mut open_by_ownership = false;
    for start in points(n) {
        let i = index(n, start);
        if live[i].is_some() || seen[i] {
            continue;
        }
        seen[i] = true;
        let (mut region, mut stack) = (Vec::new(), vec![start]);
        let (mut black, mut white) = (false, false);
        while let Some(p) = stack.pop() {
            region.push(index(n, p));
            for q in neighbours(n, p) {
                let j = index(n, q);
                match live[j] {
                    Some(Color::Black) => black = true,
                    Some(Color::White) => white = true,
                    None if !seen[j] => {
                        seen[j] = true;
                        stack.push(q);
                    }
                    None => {}
                }
            }
        }
        let owner = match (black, white) {
            (true, false) => Some(Color::Black),
            (false, true) => Some(Color::White),
            _ => None,
        };
        for j in region {
            owners[j] = owner.or_else(|| {
                let settled = match ownership?.get(j).copied().unwrap_or(0) {
                    v if v >= SETTLED => Color::Black,
                    v if v <= -SETTLED => Color::White,
                    _ => return None,
                };
                open_by_ownership = true;
                Some(settled)
            });
        }
    }
    Score {
        open_by_ownership,
        ..tally(board, &live, owners, scoring, komi, captures)
    }
}

/// The estimate: dead stones from `suggested_dead`, and every empty or dead point goes to the
/// side its ownership (Black's view) is above zero for; exactly zero is neutral.
pub fn estimate(
    board: &Board,
    ownership: &[i8],
    scoring: ScoringRule,
    komi: Komi,
    captures: (u32, u32),
) -> Score {
    let live = live_stones(board, &suggested_dead(board, ownership));
    let owners = live
        .iter()
        .enumerate()
        .map(|(i, &stone)| {
            stone.or(match ownership.get(i).copied().unwrap_or(0) {
                v if v > 0 => Some(Color::Black),
                v if v < 0 => Some(Color::White),
                _ => None,
            })
        })
        .collect();
    tally(board, &live, owners, scoring, komi, captures)
}

fn index(n: u8, p: Point) -> usize {
    usize::from(p.y) * usize::from(n) + usize::from(p.x)
}

fn points(n: u8) -> impl Iterator<Item = Point> {
    (0..n).flat_map(move |y| (0..n).map(move |x| Point { x, y }))
}

fn neighbours(n: u8, p: Point) -> impl Iterator<Item = Point> {
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

/// The board's stones with `dead` removed, row by row.
fn live_stones(board: &Board, dead: &[Point]) -> Vec<Option<Color>> {
    let n = board.size().get();
    let mut live = board.stones();
    for &p in dead {
        if p.x < n && p.y < n {
            live[index(n, p)] = None;
        }
    }
    live
}

fn tally(
    board: &Board,
    live: &[Option<Color>],
    owners: Vec<Option<Color>>,
    scoring: ScoringRule,
    komi: Komi,
    captures: (u32, u32),
) -> Score {
    let side = |prisoners| ScoreSide {
        stones: 0,
        territory: 0,
        dead: 0,
        prisoners,
        total: 0.0,
    };
    let (mut black, mut white) = (side(captures.0), side(captures.1));
    let stones = board.stones();
    for (i, owner) in owners.iter().enumerate() {
        let s = match owner {
            Some(Color::Black) => &mut black,
            Some(Color::White) => &mut white,
            None => continue,
        };
        if live[i].is_some() {
            s.stones += 1;
        } else if stones[i].is_some() {
            s.dead += 1;
        } else {
            s.territory += 1;
        }
    }
    let total = |s: &ScoreSide| match scoring {
        ScoringRule::Area => f64::from(s.stones + s.territory + s.dead),
        // A dead stone is worth two: the point it stood on, and the prisoner it becomes.
        ScoringRule::Territory => f64::from(s.territory + 2 * s.dead + s.prisoners),
    };
    black.total = total(&black);
    white.total = total(&white) + komi.points();
    Score {
        margin: black.total - white.total,
        black,
        white,
        komi: komi.points(),
        owners,
        open_by_ownership: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BoardSize;

    /// The mockup's finished 9×9 game (`docs/design/mockups/p2-m2/final-scoring.html`).
    const ROWS: [&str; 9] = [
        "...XO....",
        "...XO....",
        "...XO....",
        "..XXOO...",
        "..OXXO...",
        "....XOOX.",
        "...XXXO..",
        "...XOOO..",
        "...XO....",
    ];
    const C5: Point = Point { x: 2, y: 4 };
    const H4: Point = Point { x: 7, y: 5 };
    const CAPTURES: (u32, u32) = (2, 3);

    fn board(rows: &[&str]) -> Board {
        let mut b = Board::new(BoardSize::new(rows.len() as u8).unwrap());
        for (y, row) in rows.iter().enumerate() {
            for (x, c) in row.chars().enumerate() {
                let stone = match c {
                    'X' => Some(Color::Black),
                    'O' => Some(Color::White),
                    _ => None,
                };
                b.set(
                    Point {
                        x: x as u8,
                        y: y as u8,
                    },
                    stone,
                );
            }
        }
        b
    }

    fn komi(k: f64) -> Komi {
        Komi::new(k).unwrap()
    }

    #[test]
    fn area_score_matches_the_mockup() {
        let s = final_score(
            &board(&ROWS),
            &[C5, H4],
            None,
            ScoringRule::Area,
            komi(7.5),
            CAPTURES,
        );
        // The mockup's 地 column is territory plus dead stones: 27 and 28.
        assert_eq!(
            (
                s.black.stones,
                s.black.territory,
                s.black.dead,
                s.black.total
            ),
            (13, 26, 1, 40.0)
        );
        assert_eq!(
            (
                s.white.stones,
                s.white.territory,
                s.white.dead,
                s.white.total
            ),
            (13, 27, 1, 48.5)
        );
        assert_eq!(s.margin, -8.5);
        assert_eq!(s.komi, 7.5);
    }

    #[test]
    fn territory_score_matches_the_mockup() {
        let s = final_score(
            &board(&ROWS),
            &[C5, H4],
            None,
            ScoringRule::Territory,
            komi(6.5),
            CAPTURES,
        );
        assert_eq!(
            (
                s.black.territory,
                s.black.dead,
                s.black.prisoners,
                s.black.total
            ),
            // A dead stone counts twice: its empty point, and the prisoner it becomes.
            (26, 1, 2, 30.0)
        );
        assert_eq!(
            (
                s.white.territory,
                s.white.dead,
                s.white.prisoners,
                s.white.total
            ),
            (27, 1, 3, 38.5)
        );
        assert_eq!(s.margin, -8.5);
    }

    #[test]
    fn territory_counts_a_dead_stone_as_a_point_and_a_prisoner() {
        // Only White's C5 dead: Black's area holds it, White has none. A hand count gives Black
        // 26 empty points + C5's point + C5 as a prisoner + 2 captured = 30, White 3 + 6.5.
        let s = final_score(
            &board(&ROWS),
            &[C5],
            None,
            ScoringRule::Territory,
            komi(6.5),
            CAPTURES,
        );
        assert_eq!(
            (s.black.territory, s.black.dead, s.black.total),
            (26, 1, 30.0)
        );
        assert_eq!(s.white.total, 9.5);
        assert_eq!(s.margin, 20.5);
    }

    #[test]
    fn a_region_touching_both_colours_is_neutral() {
        // H4 alive: White's right side now touches a live Black stone, so it is no one's.
        let s = final_score(
            &board(&ROWS),
            &[C5],
            None,
            ScoringRule::Area,
            komi(7.5),
            CAPTURES,
        );
        assert_eq!(
            (
                s.black.stones,
                s.black.territory,
                s.black.dead,
                s.black.total
            ),
            (14, 26, 1, 41.0)
        );
        assert_eq!(
            (
                s.white.stones,
                s.white.territory,
                s.white.dead,
                s.white.total
            ),
            (13, 0, 0, 20.5)
        );
        assert_eq!(s.margin, 20.5);
        assert_eq!(s.owners[8], None);
    }

    #[test]
    fn toggling_a_group_toggles_every_stone() {
        let b = board(&ROWS);
        assert_eq!(group_of(&b, C5), vec![C5]);
        let mut white_wall = group_of(&b, Point { x: 4, y: 0 });
        white_wall.sort_by_key(|p| (p.y, p.x));
        assert_eq!(white_wall.len(), 13);
        assert!(white_wall.contains(&Point { x: 6, y: 7 }));
        assert!(group_of(&b, Point { x: 0, y: 0 }).is_empty());
    }

    #[test]
    fn suggested_dead_uses_the_settled_threshold() {
        let b = board(&ROWS);
        let mut own = vec![0i8; 81];
        own[usize::from(C5.y) * 9 + usize::from(C5.x)] = 76; // White stone, Black's: dead
        own[usize::from(H4.y) * 9 + usize::from(H4.x)] = -75; // Black stone, not quite settled
        assert_eq!(suggested_dead(&b, &own), vec![C5]);
    }

    #[test]
    fn estimate_assigns_every_point_by_sign() {
        let b = board(&["X..", "...", "..O"]);
        let own: Vec<i8> = vec![100, 10, 0, 5, 0, -5, 0, -10, -100];
        let s = estimate(&b, &own, ScoringRule::Area, komi(0.5), (0, 0));
        assert_eq!((s.black.stones, s.black.territory), (1, 2));
        assert_eq!((s.white.stones, s.white.territory), (1, 2));
        assert_eq!(s.owners[2], None);
        assert_eq!(s.margin, -0.5);
    }

    #[test]
    fn empty_board_scores_komi_only() {
        let b = Board::new(BoardSize::new(9).unwrap());
        let s = final_score(&b, &[], None, ScoringRule::Area, komi(7.5), (0, 0));
        assert_eq!((s.black.total, s.white.total, s.margin), (0.0, 7.5, -7.5));
        assert!(s.owners.iter().all(Option::is_none));
    }

    /// A game left open below row 4: Black's wall on D, White's on E, nothing closed.
    const OPEN: [&str; 9] = [
        "...XO....",
        "...XO....",
        "...XO....",
        "...XO....",
        ".........",
        ".........",
        ".O.......",
        ".........",
        ".........",
    ];

    /// Black owns the columns left of E, White those right of it; E's empty points are even.
    fn open_ownership() -> Vec<i8> {
        (0..81)
            .map(|i| match i % 9 {
                0..=3 => 100,
                4 => 0,
                _ => -100,
            })
            .collect()
    }

    #[test]
    fn open_regions_follow_the_ownership() {
        // Without ownership the one open region touches both walls, so nothing is counted.
        let b = board(&OPEN);
        let s = final_score(&b, &[], None, ScoringRule::Territory, komi(6.5), (0, 0));
        assert_eq!((s.black.territory, s.white.territory), (0, 0));
        assert!(!s.open_by_ownership);
        // With it, each open point settled for a side (0.6 or more) is that side's; E stays even.
        // White's lone stone on B3 is marked dead, and Black's area holds it.
        let own = open_ownership();
        let dead = [Point { x: 1, y: 6 }];
        let s = final_score(
            &b,
            &dead,
            Some(&own),
            ScoringRule::Territory,
            komi(6.5),
            (0, 0),
        );
        assert_eq!((s.black.territory, s.black.dead), (31, 1));
        assert_eq!((s.white.territory, s.white.dead), (36, 0));
        assert_eq!((s.black.total, s.white.total), (33.0, 42.5));
        assert!(s.open_by_ownership);
        assert_eq!(s.owners[4 * 9 + 4], None);
    }

    #[test]
    fn a_finished_game_counts_the_same_with_ownership() {
        // A played-out game's open regions are its dame, which KataGo calls even: the count is
        // the one without ownership, and nothing is said about an unfinished game.
        let b = board(&ROWS);
        let without = final_score(&b, &[C5], None, ScoringRule::Territory, komi(6.5), CAPTURES);
        let own: Vec<i8> = without
            .owners
            .iter()
            .map(|o| match o {
                Some(Color::Black) => 100,
                Some(Color::White) => -100,
                None => 0,
            })
            .collect();
        let with = final_score(
            &b,
            &[C5],
            Some(&own),
            ScoringRule::Territory,
            komi(6.5),
            CAPTURES,
        );
        assert_eq!(with, without);
        assert!(!with.open_by_ownership);
    }
}
