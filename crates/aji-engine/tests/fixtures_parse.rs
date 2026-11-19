use aji_core::{BoardSize, Komi, Position, Rules};
use aji_engine::{KataLine, RawAnalysis, parse_line, to_update};
use serde_json::Value;

fn out_lines() -> Vec<String> {
    let raw = include_str!("fixtures/katago/1.18.2-metal/analysis.jsonl");
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .filter(|v| v["s"] == "out")
        .map(|v| v["line"].as_str().unwrap().to_owned())
        .collect()
}

fn analyses(id: &str) -> Vec<RawAnalysis> {
    out_lines()
        .iter()
        .filter_map(|l| match parse_line(l) {
            KataLine::Analysis(a) if a.id == id => Some(a),
            _ => None,
        })
        .collect()
}

#[test]
fn every_out_line_is_recognised() {
    let lines = out_lines();
    assert!(!lines.is_empty());
    for l in &lines {
        assert!(
            !matches!(parse_line(l), KataLine::Unrecognised(_)),
            "unrecognised: {}",
            &l[..l.len().min(120)]
        );
    }
}

#[test]
fn specific_lines_map_to_variants() {
    let lines = out_lines();
    let parsed: Vec<KataLine> = lines.iter().map(|l| parse_line(l)).collect();

    assert!(parsed.iter().any(|k| matches!(k,
        KataLine::Ack { id, action, version }
            if id == "aji-version" && action == "query_version"
                && version.as_deref() == Some("1.18.2"))));
    assert!(parsed.iter().any(|k| matches!(k,
        KataLine::Ack { id, action, .. } if id == "p2-terminate" && action == "terminate")));
    assert!(
        parsed
            .iter()
            .any(|k| matches!(k, KataLine::NoResults { id } if id == "ta3"))
    );
    assert!(parsed.iter().any(|k| matches!(k,
        KataLine::QueryError { id: None, message, .. } if message.contains("parse_error"))));
    assert!(parsed.iter().any(|k| matches!(k,
        KataLine::QueryError { id: Some(id), field: Some(f), message }
            if id == "e2" && f == "moves" && message.contains("Illegal move"))));
    assert!(parsed.iter().any(|k| matches!(k,
        KataLine::Warning { id: Some(id), field: Some(f), .. } if id == "e4" && f == "notAField")));

    let p1 = analyses("p1");
    assert_eq!(p1.len(), 9);
    assert_eq!(p1.iter().filter(|a| !a.is_during_search).count(), 1);
}

fn empty_19() -> Position {
    Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap())
}

#[test]
fn p0_update_is_trimmed() {
    let p0 = analyses("p0");
    assert_eq!(p0.len(), 1);
    let raw = &p0[0];
    assert_eq!(raw.move_infos.len(), 270);
    let pos = empty_19();
    let u = to_update(raw, &pos, 20);
    assert_eq!(u.candidates.len(), 20);
    let orders: Vec<u32> = u.candidates.iter().map(|c| c.order).collect();
    assert_eq!(orders, (0..20).collect::<Vec<u32>>());
    assert!(u.is_final);
    assert_eq!(u.board_size, 19);
    assert_eq!(u.position, pos.key());
    assert_eq!(u.root_visits, raw.root_info.visits);

    let first = raw.move_infos.iter().find(|m| m.order == 0).unwrap();
    assert_eq!(
        u.candidates[0].mv,
        aji_core::move_from_gtp(&first.mv, pos.size).unwrap()
    );
    assert_eq!(u.candidates[0].visits, first.visits);
}

#[test]
fn pv_is_converted() {
    let raw = &analyses("p0")[0];
    let u = to_update(raw, &empty_19(), 20);
    let c = &u.candidates[0];
    assert!(!c.pv.is_empty());
    assert_eq!(c.pv[0], c.mv);
}
