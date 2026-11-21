//! The UI-facing analysis update, converted from KataGo's raw response.

use aji_core::{Move, Position, PositionKey, move_from_gtp};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::response::RawAnalysis;

/// One candidate move. Winrate and score lead are Black's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Candidate {
    #[serde(rename = "move")]
    #[ts(rename = "move")]
    pub mv: Move,
    pub order: u32,
    pub visits: u32,
    pub winrate: f64,
    pub score_lead: f64,
    pub prior: f64,
    pub pv: Vec<Move>,
}

/// A snapshot of the analysis of one position. Winrate and score lead are Black's,
/// guaranteed by the launch override `reportAnalysisWinratesAs=BLACK`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AnalysisUpdate {
    pub position: PositionKey,
    pub board_size: u8,
    pub root_visits: u32,
    pub winrate: f64,
    pub score_lead: f64,
    pub is_final: bool,
    pub candidates: Vec<Candidate>,
    /// The root visits the position had in the cache when this search started: a new search
    /// starts from zero, and is catching up while it has fewer (design 5.2).
    pub previous_visits: u32,
}

/// Converts a raw response for `position`. Candidates are sorted by `order` and truncated
/// to `max_candidates`; symmetry copies are kept. A candidate whose move does not parse is
/// dropped, and a PV is cut at its first entry that does not parse.
pub fn to_update(raw: &RawAnalysis, position: &Position, max_candidates: usize) -> AnalysisUpdate {
    let size = position.size;
    let mut infos: Vec<_> = raw.move_infos.iter().collect();
    infos.sort_by_key(|m| m.order);
    let candidates = infos
        .into_iter()
        .filter_map(|m| {
            let mv = move_from_gtp(&m.mv, size).ok()?;
            let pv =
                m.pv.iter()
                    .map_while(|s| move_from_gtp(s, size).ok())
                    .collect();
            Some(Candidate {
                mv,
                order: m.order,
                visits: m.visits,
                winrate: m.winrate,
                score_lead: m.score_lead,
                prior: m.prior,
                pv,
            })
        })
        .take(max_candidates)
        .collect();
    AnalysisUpdate {
        position: position.key(),
        board_size: size.get(),
        root_visits: raw.root_info.visits,
        winrate: raw.root_info.winrate,
        score_lead: raw.root_info.score_lead,
        is_final: !raw.is_during_search,
        candidates,
        previous_visits: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_converted_update_has_no_previous_visits() {
        let raw = RawAnalysis {
            id: "q".into(),
            is_during_search: true,
            turn_number: 0,
            root_info: crate::response::RawRootInfo {
                visits: 7,
                winrate: 0.5,
                score_lead: 0.0,
            },
            move_infos: Vec::new(),
        };
        let position = Position::empty(
            aji_core::BoardSize::NINETEEN,
            aji_core::Rules::Chinese,
            aji_core::Komi::new(7.5).unwrap(),
        );
        assert_eq!(to_update(&raw, &position, 10).previous_visits, 0);
    }
    use crate::response::{RawMoveInfo, RawRootInfo};
    use aji_core::{BoardSize, Komi, Point, Rules};

    fn info(mv: &str, order: u32, pv: &[&str]) -> RawMoveInfo {
        RawMoveInfo {
            mv: mv.to_owned(),
            order,
            visits: 10,
            winrate: 0.5,
            score_lead: 0.0,
            prior: 0.1,
            pv: pv.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    fn raw(infos: Vec<RawMoveInfo>) -> RawAnalysis {
        RawAnalysis {
            id: "x".into(),
            is_during_search: true,
            turn_number: 0,
            root_info: RawRootInfo {
                visits: 10,
                winrate: 0.5,
                score_lead: 0.0,
            },
            move_infos: infos,
        }
    }

    fn pos() -> Position {
        Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap())
    }

    #[test]
    fn candidates_are_sorted_by_order() {
        let r = raw(vec![
            info("D4", 2, &[]),
            info("Q16", 0, &[]),
            info("C3", 1, &[]),
        ]);
        let u = to_update(&r, &pos(), 20);
        let orders: Vec<u32> = u.candidates.iter().map(|c| c.order).collect();
        assert_eq!(orders, vec![0, 1, 2]);
        let u = to_update(&r, &pos(), 2);
        let orders: Vec<u32> = u.candidates.iter().map(|c| c.order).collect();
        assert_eq!(orders, vec![0, 1]);
    }

    #[test]
    fn bad_pv_entry_drops_the_rest_of_the_pv() {
        let r = raw(vec![info("D4", 0, &["D4", "ZZ", "Q16"])]);
        let u = to_update(&r, &pos(), 20);
        assert_eq!(u.candidates[0].pv, vec![Move::Play(Point { x: 3, y: 15 })]);
    }

    #[test]
    fn bad_candidate_move_is_dropped() {
        let r = raw(vec![info("ZZ", 0, &[]), info("D4", 1, &[])]);
        let u = to_update(&r, &pos(), 20);
        assert_eq!(u.candidates.len(), 1);
        assert_eq!(u.candidates[0].order, 1);
    }
}
