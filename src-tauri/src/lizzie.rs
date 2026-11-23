//! LizzieYzy's `LZ` analysis as Aji's results (P2 M2 design 5.11). LizzieYzy writes the side
//! to move's numbers (the head's win rate as 100 minus it); Aji keeps Black's. GPL code is a
//! feature reference only: this follows the design's own description.

use aji_core::sgf::{LzData, LzMove};
use aji_core::{BoardSize, Color, Move, PositionKey, move_from_gtp, move_to_gtp};
use aji_engine::{AnalysisUpdate, Candidate, quantise_ownership};

/// The engine name written into `LZ`.
const ENGINE: &str = "KataGo";

/// A value from the side to move's view, in Black's: win rates are flipped around one half,
/// leads and ownership change sign.
fn black_winrate(winrate: f64, to_move: Color) -> f64 {
    match to_move {
        Color::Black => winrate,
        Color::White => 1.0 - winrate,
    }
}

fn black_sign(to_move: Color) -> f64 {
    match to_move {
        Color::Black => 1.0,
        Color::White => -1.0,
    }
}

/// The moves of a principal variation, up to the first one that does not read.
fn moves_of(points: &[String], size: BoardSize) -> Vec<Move> {
    points
        .iter()
        .map_while(|p| move_from_gtp(p, size).ok())
        .collect()
}

/// One `LZ` value as a result for `key`, where `to_move` moves. Candidates whose point does not
/// read are dropped.
pub fn update_from_lz(
    data: &LzData,
    key: PositionKey,
    size: BoardSize,
    to_move: Color,
) -> AnalysisUpdate {
    let sign = black_sign(to_move);
    let lead = data
        .score_lead
        .or_else(|| data.moves.first().and_then(|m| m.score_lead))
        .unwrap_or(0.0);
    let candidates = data
        .moves
        .iter()
        .filter_map(|m| Some((move_from_gtp(&m.point, size).ok()?, m)))
        .enumerate()
        .map(|(order, (mv, m))| Candidate {
            mv,
            order: order as u32,
            visits: m.visits,
            winrate: black_winrate(m.winrate, to_move),
            score_lead: sign * m.score_lead.unwrap_or(lead),
            prior: m.prior,
            pv: moves_of(&m.pv, size),
        })
        .collect();
    AnalysisUpdate {
        position: key,
        board_size: size.get(),
        root_visits: data.visits,
        winrate: black_winrate(1.0 - data.mover_winrate / 100.0, to_move),
        score_lead: sign * lead,
        is_final: true,
        candidates,
        previous_visits: 0,
        ownership: data
            .ownership
            .as_ref()
            .map(|own| own.iter().map(|v| quantise_ownership(sign * v)).collect()),
        next: None,
    }
}

/// A result as one `LZ` value, where `to_move` moves.
pub fn lz_from_update(update: &AnalysisUpdate, size: BoardSize, to_move: Color) -> LzData {
    let sign = black_sign(to_move);
    let gtp = |mv: &Move| move_to_gtp(*mv, size).ok();
    LzData {
        engine: ENGINE.to_owned(),
        mover_winrate: (1.0 - black_winrate(update.winrate, to_move)) * 100.0,
        visits: update.root_visits,
        score_lead: Some(sign * update.score_lead),
        score_stdev: None,
        moves: update
            .candidates
            .iter()
            .filter_map(|c| {
                Some(LzMove {
                    point: gtp(&c.mv)?,
                    visits: c.visits,
                    winrate: black_winrate(c.winrate, to_move),
                    prior: c.prior,
                    score_lead: Some(sign * c.score_lead),
                    pv: c.pv.iter().map_while(gtp).collect(),
                })
            })
            .collect(),
        // Two decimals, as LizzieYzy writes it.
        ownership: update.ownership.as_ref().map(|own| {
            own.iter()
                .map(|&q| (sign * f64::from(q) / 127.0 * 100.0).round() / 100.0)
                .collect()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aji_core::sgf::{parse_lz, write_lz};

    fn nine() -> BoardSize {
        BoardSize::new(9).unwrap()
    }

    fn sample() -> AnalysisUpdate {
        AnalysisUpdate {
            position: PositionKey(5),
            board_size: 9,
            root_visits: 700,
            winrate: 0.62,
            score_lead: 3.5,
            is_final: true,
            candidates: vec![Candidate {
                mv: Move::Play(aji_core::Point { x: 2, y: 6 }),
                order: 0,
                visits: 500,
                winrate: 0.63,
                score_lead: 3.6,
                prior: 0.31,
                pv: vec![Move::Play(aji_core::Point { x: 2, y: 6 }), Move::Pass],
            }],
            previous_visits: 0,
            ownership: Some(vec![100, -100, 0, 127, -127, 64, -64, 1, -1]),
            next: None,
        }
    }

    #[test]
    fn white_to_move_is_written_from_whites_view_and_read_back_as_blacks() {
        let lz = lz_from_update(&sample(), nine(), Color::White);
        // White, to move, has 38%: the head holds 100 − 38.
        assert!((lz.mover_winrate - 62.0).abs() < 1e-9);
        assert_eq!(lz.score_lead, Some(-3.5));
        assert_eq!(lz.moves[0].point, "C3");
        assert!((lz.moves[0].winrate - 0.37).abs() < 1e-9);
        assert_eq!(lz.moves[0].pv, vec!["C3".to_owned(), "pass".to_owned()]);
        assert_eq!(lz.ownership.as_ref().unwrap()[0], -0.79);
        let text = write_lz(&lz);
        let back = update_from_lz(
            &parse_lz(&text, 9).unwrap(),
            PositionKey(5),
            nine(),
            Color::White,
        );
        let want = sample();
        assert!((back.winrate - want.winrate).abs() < 1e-9);
        assert!((back.score_lead - want.score_lead).abs() < 1e-9);
        assert_eq!(back.candidates[0].mv, want.candidates[0].mv);
        assert_eq!(back.candidates[0].pv, want.candidates[0].pv);
        assert!((back.candidates[0].winrate - 0.63).abs() < 1e-9);
        let own = back.ownership.unwrap();
        let orig = want.ownership.unwrap();
        assert!(
            own.iter().zip(&orig).all(|(a, b)| (a - b).abs() <= 1),
            "{own:?}"
        );
    }

    #[test]
    fn unreadable_points_are_dropped() {
        let text = "KataGo 50.0 100 0.0\nmove Z99 visits 50 winrate 5000 prior 100 pv Z99 info \
                    move C3 visits 40 winrate 4900 prior 100 pv C3 Z99 D4";
        let update = update_from_lz(
            &parse_lz(text, 81).unwrap(),
            PositionKey(1),
            nine(),
            Color::Black,
        );
        assert_eq!(update.candidates.len(), 1);
        assert_eq!(update.candidates[0].order, 0);
        assert_eq!(
            update.candidates[0].pv.len(),
            1,
            "the pv stops at the first bad point"
        );
    }
}
