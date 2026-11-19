//! Builders for the one-line JSON queries sent to KataGo's analysis engine.

use std::time::Duration;

use aji_core::{CoreError, Position, move_to_gtp};
use serde_json::{Value, json};

/// Builds an analysis query line (without a trailing newline).
///
/// A point off the board gives `PointOffBoard`.
pub fn analysis_query(
    id: &str,
    position: &Position,
    max_visits: u32,
    report_every: Duration,
) -> Result<String, CoreError> {
    let moves = position
        .moves
        .iter()
        .map(|&(c, mv)| Ok(json!([c.gtp(), move_to_gtp(mv, position.size)?])))
        .collect::<Result<Vec<Value>, CoreError>>()?;
    let mut q = json!({
        "id": id,
        "moves": moves,
        "rules": position.rules.katago_name(),
        "komi": position.komi.points(),
        "boardXSize": position.size.get(),
        "boardYSize": position.size.get(),
        "maxVisits": max_visits,
        "reportDuringSearchEvery": report_every.as_secs_f64(),
    });
    if !position.setup.is_empty() {
        let stones = position
            .setup
            .iter()
            .map(|&(c, p)| {
                let at = move_to_gtp(aji_core::Move::Play(p), position.size)?;
                Ok(json!([c.gtp(), at]))
            })
            .collect::<Result<Vec<Value>, CoreError>>()?;
        q["initialStones"] = Value::Array(stones);
    }
    Ok(q.to_string())
}

/// Builds an `{"id":…,"action":…}` query, such as `query_version` or `terminate_all`.
pub fn action_query(id: &str, action: &str) -> String {
    json!({ "id": id, "action": action }).to_string()
}

/// Builds a `terminate` query for the analysis query `target`.
pub fn terminate_query(id: &str, target: &str) -> String {
    json!({ "id": id, "action": "terminate", "terminateId": target }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aji_core::{BoardSize, Color, Komi, Move, Point, Rules};

    fn p1() -> Position {
        let mut p = Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap());
        p.moves = vec![
            (Color::Black, Move::Play(Point { x: 15, y: 3 })),
            (Color::White, Move::Play(Point { x: 3, y: 15 })),
        ];
        p
    }

    #[test]
    fn query_json_shape() {
        let line = analysis_query("aji-1", &p1(), 100_000, Duration::from_millis(100)).unwrap();
        assert!(!line.contains('\n'));
        let v: Value = serde_json::from_str(&line).unwrap();
        let want = json!({"id":"aji-1","moves":[["B","Q16"],["W","D4"]],"rules":"chinese","komi":7.5,"boardXSize":19,"boardYSize":19,"maxVisits":100000,"reportDuringSearchEvery":0.1});
        assert_eq!(v, want);
    }

    #[test]
    fn initial_stones_are_sent_when_present() {
        let mut p = p1();
        p.moves.clear();
        p.setup = vec![(Color::Black, Point { x: 3, y: 15 })];
        let v: Value =
            serde_json::from_str(&analysis_query("a", &p, 10, Duration::from_millis(100)).unwrap())
                .unwrap();
        assert_eq!(v["initialStones"], json!([["B", "D4"]]));
    }

    #[test]
    fn off_board_points_are_an_error() {
        let mut p = p1();
        p.moves
            .push((Color::Black, Move::Play(Point { x: 19, y: 0 })));
        let off = Point { x: 19, y: 0 };
        assert_eq!(
            analysis_query("a", &p, 10, Duration::from_millis(100)),
            Err(CoreError::PointOffBoard(off))
        );
        let mut p = p1();
        p.setup = vec![(Color::Black, off)];
        assert!(analysis_query("a", &p, 10, Duration::from_millis(100)).is_err());
    }

    #[test]
    fn action_and_terminate_queries() {
        let v: Value = serde_json::from_str(&action_query("x", "query_version")).unwrap();
        assert_eq!(v, json!({"id":"x","action":"query_version"}));
        let v: Value = serde_json::from_str(&terminate_query("t", "q")).unwrap();
        assert_eq!(v, json!({"id":"t","action":"terminate","terminateId":"q"}));
    }
}
