//! A move's loss, defined once (P2 M2 design 5.1): the mover's win rate before the move minus
//! after it, in percentage points, and the same for the score lead, in points.

use aji_core::{Color, Move};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{AnalysisUpdate, TrendStats};

/// Positive is a loss for the mover, negative a gain.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Loss {
    /// Percentage points.
    pub winrate: f64,
    /// Points.
    pub score: f64,
}

/// The loss from the root results before and after the move, both in Black's view.
pub fn move_loss(before: &TrendStats, after: &TrendStats, mover: Color) -> Loss {
    loss(
        before.winrate,
        before.score_lead,
        after.winrate,
        after.score_lead,
        mover,
    )
}

/// The loss from the before-position's candidate list: its root against the played candidate,
/// in the mover's view. `None` when KataGo did not list the played move.
pub fn loss_from_candidates(before: &AnalysisUpdate, played: Move, mover: Color) -> Option<Loss> {
    let c = before.candidates.iter().find(|c| c.mv == played)?;
    Some(loss(
        before.winrate,
        before.score_lead,
        c.winrate,
        c.score_lead,
        mover,
    ))
}

/// Black-view numbers before and after, as a loss for `mover`.
fn loss(winrate: f64, score: f64, after_winrate: f64, after_score: f64, mover: Color) -> Loss {
    let sign = match mover {
        Color::Black => 1.0,
        Color::White => -1.0,
    };
    Loss {
        winrate: sign * (winrate - after_winrate) * 100.0,
        score: sign * (score - after_score),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aji_core::{Point, PositionKey};

    use crate::Candidate;

    fn stats(winrate: f64, score_lead: f64) -> TrendStats {
        TrendStats {
            winrate,
            score_lead,
            visits: 100,
        }
    }

    fn close(a: Loss, winrate: f64, score: f64) {
        assert!((a.winrate - winrate).abs() < 1e-9, "{a:?} winrate");
        assert!((a.score - score).abs() < 1e-9, "{a:?} score");
    }

    #[test]
    fn black_loses_when_blacks_winrate_drops() {
        close(
            move_loss(&stats(0.60, 3.0), &stats(0.45, 1.0), Color::Black),
            15.0,
            2.0,
        );
    }

    #[test]
    fn white_loses_when_blacks_winrate_rises() {
        close(
            move_loss(&stats(0.40, -2.0), &stats(0.52, 0.5), Color::White),
            12.0,
            2.5,
        );
    }

    #[test]
    fn a_gain_is_negative() {
        close(
            move_loss(&stats(0.50, 0.0), &stats(0.55, 1.0), Color::Black),
            -5.0,
            -1.0,
        );
    }

    fn update(candidates: Vec<(Move, f64, f64)>) -> AnalysisUpdate {
        AnalysisUpdate {
            position: PositionKey(1),
            board_size: 19,
            root_visits: 500,
            winrate: 0.58,
            score_lead: 2.0,
            is_final: true,
            candidates: candidates
                .into_iter()
                .enumerate()
                .map(|(i, (mv, winrate, score_lead))| Candidate {
                    mv,
                    order: i as u32,
                    visits: 100,
                    winrate,
                    score_lead,
                    prior: 0.1,
                    pv: vec![mv],
                })
                .collect(),
            previous_visits: 0,
            ownership: None,
        }
    }

    const A: Move = Move::Play(Point { x: 3, y: 3 });
    const B: Move = Move::Play(Point { x: 15, y: 15 });

    #[test]
    fn loss_from_candidates_uses_the_played_candidate() {
        let u = update(vec![(A, 0.58, 2.0), (B, 0.50, 0.5)]);
        close(loss_from_candidates(&u, B, Color::Black).unwrap(), 8.0, 1.5);
        // White to move in the same numbers: a candidate raising Black's win rate is White's loss.
        let w = update(vec![(A, 0.58, 2.0), (B, 0.61, 3.0)]);
        close(loss_from_candidates(&w, B, Color::White).unwrap(), 3.0, 1.0);
    }

    #[test]
    fn an_unlisted_move_has_no_candidate_loss() {
        let u = update(vec![(A, 0.58, 2.0)]);
        assert_eq!(loss_from_candidates(&u, B, Color::Black), None);
        assert_eq!(loss_from_candidates(&u, Move::Pass, Color::Black), None);
    }
}
