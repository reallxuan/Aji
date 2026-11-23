//! Every SGF fixture opens (or fails as it should), reads its names correctly, and survives a
//! save unchanged (design 5.3 and section 7).

use std::fs;
use std::path::{Path, PathBuf};

use aji_core::game::{AnalysisRules, Board, Game, GameError, Illegal};
use aji_core::sgf::{SgfTree, SgfWarning, decode, parse_lz, parse_sgf, write_sgf};
use aji_core::{BoardSize, Color, Move};
use proptest::prelude::*;

fn dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sgf")
}

fn fixtures() -> Vec<(String, Vec<u8>)> {
    let mut out: Vec<_> = fs::read_dir(dir())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "sgf"))
        .map(|p| {
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            (name, fs::read(&p).unwrap())
        })
        .collect();
    out.sort();
    assert!(out.len() >= 30, "fixtures missing: run make.py");
    out
}

fn read(name: &str) -> Vec<u8> {
    fs::read(dir().join(name)).unwrap()
}

fn open(bytes: &[u8]) -> Result<Game, GameError> {
    let c = parse_sgf(&decode(bytes).text).expect("parses");
    Game::from_sgf(c.games.into_iter().next().unwrap(), AnalysisRules::Chinese).map(|(g, _)| g)
}

fn last(g: &Game) -> usize {
    *g.main_line().last().unwrap()
}

#[test]
fn every_good_fixture_opens() {
    for (name, bytes) in fixtures() {
        if name.starts_with("broken-") {
            continue;
        }
        let g = open(&bytes).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        if name.starts_with("samsung-") {
            let mut board = Board::new(g.size());
            let mut count = 0;
            for &n in g.main_line() {
                if let (Some(c), Some(mv)) = (g.last_color(n), g.last_move(n)) {
                    assert_eq!(board.play(c, mv, false).illegal, None, "{name}");
                    count += 1;
                }
            }
            assert_eq!(g.board_at(last(&g)), &board, "{name}");
            assert_eq!(g.move_number(last(&g)), count, "{name}");
            assert!(count > 100, "{name}: {count} moves");
        }
    }
}

#[test]
fn chinese_names_read() {
    for name in ["gbk-no-ca.sgf", "gbk-ca-gb2312.sgf", "utf8-bom.sgf"] {
        let g = open(&read(name)).unwrap();
        assert_eq!(g.info().black.as_deref(), Some("丁浩"), "{name}");
        assert_eq!(
            g.info().event.as_deref(),
            Some("第30届三星杯决赛"),
            "{name}"
        );
    }
    let g = open(&read("gb18030-rare.sgf")).unwrap();
    assert_eq!(g.info().black.as_deref(), Some("丁浩𪚥"));
    let g = open(&read("gbk-trail-bytes.sgf")).unwrap();
    let white = g.info().white.clone().unwrap();
    assert!(white.ends_with("元赫"), "{white}");
    assert_eq!(white.chars().count(), 4, "{white}");
    assert!(!white.contains('\u{FFFD}'));
    let g = open(&read("shift-jis.sgf")).unwrap();
    assert_eq!(g.info().black.as_deref(), Some("井山裕太"));
    let g = open(&read("euc-kr.sgf")).unwrap();
    assert_eq!(g.info().black.as_deref(), Some("신진서"));
    let g = open(&read("fox-chinese.sgf")).unwrap();
    assert_eq!(g.info().black.as_deref(), Some("黑方棋友"));
}

#[test]
fn round_trip() {
    for (name, bytes) in fixtures() {
        let text = decode(&bytes).text;
        let Ok(first) = parse_sgf(&text) else {
            continue;
        };
        let again = parse_sgf(&write_sgf(&first.games)).unwrap();
        assert_eq!(again.games, first.games, "{name}: tree");

        let Ok((game, _)) = Game::from_sgf(first.games[0].clone(), AnalysisRules::Chinese) else {
            continue;
        };
        let once = write_sgf(&[game.to_sgf(None)]);
        let reopened = parse_sgf(&once).unwrap();
        let (game2, _) = Game::from_sgf(
            reopened.games.into_iter().next().unwrap(),
            AnalysisRules::Chinese,
        )
        .unwrap();
        let twice = write_sgf(&[game2.to_sgf(None)]);
        assert_eq!(once, twice, "{name}: bytes");
        assert!(once.contains("CA[UTF-8]"), "{name}");
        assert_eq!(once.matches("CA[").count(), 1, "{name}");
    }
}

fn values<'a>(tree: &'a SgfTree, node: usize, id: &str) -> Option<&'a [String]> {
    tree.nodes[node].get(id).map(|p| p.values.as_slice())
}

#[test]
fn the_fixture_parses_every_lz_node() {
    let tree = parse_sgf(&decode(&read("lizzie.sgf")).text)
        .unwrap()
        .games
        .remove(0);
    let lz = |node: usize, id: &str| {
        let text = &values(&tree, node, id).unwrap()[0];
        parse_lz(text, 361).unwrap_or_else(|| panic!("node {node} {id}"))
    };
    let root = lz(0, "LZOP");
    assert_eq!(
        (root.mover_winrate, root.visits, root.moves.len()),
        (48.6, 850, 2)
    );
    assert_eq!(lz(1, "LZ").visits, 1300);
    let third = lz(2, "LZ");
    assert_eq!(third.visits, 13_000);
    assert_eq!(third.ownership.as_ref().map(Vec::len), Some(361));
    assert!(values(&tree, 3, "LZ").is_none());
    assert_eq!(lz(4, "LZ").visits, 12_500_000);
}

#[test]
fn lizzie_and_unknown_properties_survive() {
    let original = parse_sgf(&decode(&read("lizzie.sgf")).text)
        .unwrap()
        .games
        .remove(0);
    let saved = parse_sgf(&write_sgf(&[open(&read("lizzie.sgf"))
        .unwrap()
        .to_sgf(None)]))
    .unwrap()
    .games
    .remove(0);
    for (node, id) in [
        (0, "LZOP"),
        (1, "LZ"),
        (2, "LZ"),
        (4, "LZ"),
        (4, "LZ2"),
        (4, "LZOP2"),
    ] {
        assert!(values(&original, node, id).is_some(), "{id}");
        assert_eq!(
            values(&saved, node, id),
            values(&original, node, id),
            "{id}"
        );
    }

    let fox = parse_sgf(&decode(&read("fox-chinese.sgf")).text)
        .unwrap()
        .games
        .remove(0);
    let saved = parse_sgf(&write_sgf(&[open(&read("fox-chinese.sgf"))
        .unwrap()
        .to_sgf(None)]))
    .unwrap()
    .games
    .remove(0);
    for id in ["TT", "TC", "RL", "RN", "TM", "AP", "KM"] {
        assert_eq!(values(&saved, 0, id), values(&fox, 0, id), "{id}");
    }
    assert_eq!(values(&saved, 0, "AP").unwrap(), ["GNU Go:3.8", "foxwq"]);
}

#[test]
fn collection_keeps_other_games() {
    let c = parse_sgf(&decode(&read("collection.sgf")).text).unwrap();
    assert_eq!(c.warnings, [SgfWarning::ExtraGames(1)]);
    let mut games = c.games.into_iter();
    let (g, _) = Game::from_sgf(games.next().unwrap(), AnalysisRules::Chinese).unwrap();
    let mut out = vec![g.to_sgf(None)];
    out.extend(games);
    let written = parse_sgf(&write_sgf(&out)).unwrap();
    assert_eq!(written.games.len(), 2);
    assert_eq!(written.games[1].nodes[0].first("GN"), Some("second"));
}

#[test]
fn broken_files() {
    let c = parse_sgf(&decode(&read("broken-truncated.sgf")).text).unwrap();
    assert!(c.warnings.contains(&SgfWarning::Truncated));
    let g = open(&read("broken-truncated.sgf")).unwrap();
    assert!(g.move_number(last(&g)) > 150);

    let c = parse_sgf(&decode(&read("broken-missing-paren.sgf")).text).unwrap();
    assert_eq!(c.warnings, [SgfWarning::Truncated]);

    assert_eq!(
        open(&read("broken-size-19x13.sgf")).unwrap_err(),
        GameError::UnsupportedSize {
            width: 19,
            height: 13
        }
    );
    assert_eq!(
        open(&read("broken-size-21.sgf")).unwrap_err(),
        GameError::UnsupportedSize {
            width: 21,
            height: 21
        }
    );
    assert_eq!(open(&read("broken-gm2.sgf")).unwrap_err(), GameError::NotGo);

    let g = open(&read("broken-occupied.sgf")).unwrap();
    assert_eq!(g.illegal(g.main_line()[2]), Some(Illegal::Occupied));
    assert!(g.position_at(last(&g), &AnalysisRules::Chinese).is_some());
}

#[test]
fn fox_rules() {
    let rules = |name: &str| {
        let c = parse_sgf(&decode(&read(name)).text).unwrap();
        Game::from_sgf(c.games.into_iter().next().unwrap(), AnalysisRules::Chinese)
            .unwrap()
            .1
            .rules
    };
    assert_eq!(rules("fox-chinese.sgf"), AnalysisRules::Chinese);
    assert_eq!(rules("fox-japanese.sgf"), AnalysisRules::JapaneseKorean);
    assert_eq!(
        rules("samsung-2025-final-2.sgf"),
        AnalysisRules::JapaneseKorean
    );
}

proptest! {
    #[test]
    fn parser_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..4096)) {
        let text = decode(&bytes).text;
        if let Ok(c) = parse_sgf(&text) {
            let _ = write_sgf(&c.games);
            for tree in c.games {
                if let Ok((g, _)) = Game::from_sgf(tree, AnalysisRules::Chinese) {
                    let end = *g.main_line().last().unwrap();
                    let _ = g.position_at(end, &AnalysisRules::Chinese);
                    let _ = g.to_sgf(None);
                }
            }
        }
    }

    #[test]
    fn random_games_round_trip(points in proptest::collection::vec((0u8..9, 0u8..9), 0..120)) {
        let size = BoardSize::new(9).unwrap();
        let mut board = Board::new(size);
        let mut color = Color::Black;
        let mut text = String::from("(;GM[1]FF[4]SZ[9]");
        let mut boards = vec![board.clone()];
        for (x, y) in points {
            let mv = Move::Play(aji_core::Point { x, y });
            let mut trial = board.clone();
            if board.get(aji_core::Point { x, y }).is_some()
                || trial.play(color, mv, false).illegal.is_some()
            {
                continue;
            }
            board = trial;
            boards.push(board.clone());
            let letter = |v: u8| char::from(b'a' + v);
            text.push_str(&format!(";{}[{}{}]", color_letter(color), letter(x), letter(y)));
            color = color.opponent();
        }
        text.push(')');
        let c = parse_sgf(&text).unwrap();
        let (g, _) = Game::from_sgf(c.games[0].clone(), AnalysisRules::Chinese).unwrap();
        let again = parse_sgf(&write_sgf(&[g.to_sgf(None)])).unwrap();
        let (g2, _) = Game::from_sgf(again.games[0].clone(), AnalysisRules::Chinese).unwrap();
        prop_assert_eq!(g2.main_line().len(), boards.len());
        for (i, &n) in g2.main_line().iter().enumerate() {
            prop_assert_eq!(g2.board_at(n), &boards[i]);
        }
    }
}

fn color_letter(c: Color) -> &'static str {
    match c {
        Color::Black => "B",
        Color::White => "W",
    }
}
