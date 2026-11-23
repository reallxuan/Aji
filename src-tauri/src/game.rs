//! The open game (design 5.4): one game at a time, its current node on the main line, the rules
//! KataGo analyses it with, and what reading the file repaired. `service` holds it behind a
//! mutex and tells the engine about every change.

use aji_core::game::{AnalysisRules, Game, GameError, Illegal, NodeId, Preview};
use aji_core::sgf::{EncodingSource, SgfError, SgfNode, SgfTree, SgfWarning, decode, parse_sgf};
use aji_core::{BoardSize, Color, Move, Position, PositionKey};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::protocol::GameSnapshot;

/// The largest file Aji opens.
pub const MAX_SGF_BYTES: usize = 20 * 1024 * 1024;

/// Where `gameNavigate` goes, along the main line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum NavTarget {
    First,
    Last,
    Previous,
    Next,
    /// The node where move `n` was played; past the end, the last node.
    Move(u32),
}

/// Something reading the file repaired or guessed. The UI shows one line for them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "camelCase")]
#[ts(export)]
pub enum GameWarning {
    /// The file ended inside the game; what was there is open.
    Truncated,
    /// Broken syntax or bytes were skipped or repaired.
    Repaired,
    /// The file holds this many more games; only the first is open, and saving keeps them.
    ExtraGames { count: u32 },
    /// The file names no encoding; it was read as this one.
    EncodingGuessed { encoding: String },
    /// Some moves break the rules; they are shown and flagged.
    IllegalMoves,
    /// `KM` is not a usable komi.
    KomiUnreadable,
}

/// The rules in use, the file's reading, and the raw `RU` and `KM` (design 5.5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RulesState {
    pub current: AnalysisRules,
    pub from_file: AnalysisRules,
    pub changed: bool,
    pub ru: Option<String>,
    pub km: Option<String>,
}

/// Why `gameOpen` or `gameNew` failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenError {
    TooLarge,
    NotAGame,
    NotGo,
    UnsupportedSize { width: u8, height: u8 },
}

impl From<GameError> for OpenError {
    fn from(error: GameError) -> Self {
        match error {
            GameError::NotGo => OpenError::NotGo,
            GameError::UnsupportedSize { width, height } => {
                OpenError::UnsupportedSize { width, height }
            }
        }
    }
}

/// The open game and where the user is in it.
pub struct GameSession {
    game: Game,
    /// The file's other games, written back on export.
    others: Vec<SgfTree>,
    /// The current node's index on the main line.
    index: usize,
    /// The file name without `.sgf`; `None` for a new game.
    name: Option<String>,
    rules: AnalysisRules,
    from_file: AnalysisRules,
    ru: Option<String>,
    km: Option<String>,
    revision: u64,
    /// What opening the file reported; empty for a new game.
    warnings: Vec<GameWarning>,
}

fn trimmed(root: &SgfNode, id: &str) -> Option<String> {
    root.first(id)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

/// `name` without a final `.sgf`, any case; `None` when nothing is left.
fn stem(name: &str) -> Option<String> {
    let stem = match name.len().checked_sub(4) {
        Some(cut) if name.is_char_boundary(cut) && name[cut..].eq_ignore_ascii_case(".sgf") => {
            &name[..cut]
        }
        _ => name,
    };
    let stem = stem.trim();
    (!stem.is_empty()).then(|| stem.to_owned())
}

/// One main-line node, for the trend graph (design 5.3).
#[derive(Debug, Clone, PartialEq)]
pub struct LineNode {
    pub move_number: u32,
    pub mover: Option<Color>,
    pub mv: Option<Move>,
    /// `None` on an illegal node.
    pub key: Option<PositionKey>,
    /// What KataGo analyses at the node; `None` on an illegal node.
    pub position: Option<Position>,
}

/// The nodes of a tree's main line, the first variation at every branch, in order.
fn main_line_mut(tree: &mut SgfTree) -> Vec<&mut SgfNode> {
    let mut out = Vec::new();
    let mut at = Some(tree);
    while let Some(tree) = at {
        out.extend(tree.nodes.iter_mut());
        at = tree.variations.first_mut();
    }
    out
}

impl GameSession {
    /// An empty game of `size` lines (5 to 19).
    pub fn new(size: u8, rules: AnalysisRules) -> Result<GameSession, OpenError> {
        let unsupported = OpenError::UnsupportedSize {
            width: size,
            height: size,
        };
        if !(5..=19).contains(&size) || BoardSize::new(size).is_err() {
            return Err(unsupported);
        }
        let mut root = SgfNode::default();
        root.push("SZ", [size.to_string()]);
        let tree = SgfTree {
            nodes: vec![root],
            variations: Vec::new(),
        };
        let (game, reading) = Game::from_sgf(tree, rules)?;
        Ok(GameSession {
            game,
            others: Vec::new(),
            index: 0,
            name: None,
            rules: reading.rules,
            from_file: reading.rules,
            ru: None,
            km: None,
            revision: 0,
            warnings: Vec::new(),
        })
    }

    /// Reads a file: decodes it, parses it, and builds the first game. `default_rules` applies
    /// when the file names neither rules nor komi.
    pub fn open(
        name: &str,
        bytes: &[u8],
        default_rules: AnalysisRules,
    ) -> Result<GameSession, OpenError> {
        if bytes.len() > MAX_SGF_BYTES {
            return Err(OpenError::TooLarge);
        }
        let decoded = decode(bytes);
        let collection =
            parse_sgf(&decoded.text).map_err(|SgfError::NotAGame| OpenError::NotAGame)?;
        let mut games = collection.games.into_iter();
        let first = games.next().ok_or(OpenError::NotAGame)?;
        let others: Vec<SgfTree> = games.collect();
        let root = first.nodes.first().cloned().unwrap_or_default();
        let (game, reading) = Game::from_sgf(first, default_rules)?;

        let mut warnings = Vec::new();
        let parsed = &collection.warnings;
        if parsed.contains(&SgfWarning::Truncated) {
            warnings.push(GameWarning::Truncated);
        } else if decoded.replaced
            || parsed
                .iter()
                .any(|w| matches!(w, SgfWarning::UnclosedValue | SgfWarning::Skipped))
        {
            warnings.push(GameWarning::Repaired);
        }
        if !others.is_empty() {
            warnings.push(GameWarning::ExtraGames {
                count: u32::try_from(others.len()).unwrap_or(u32::MAX),
            });
        }
        if decoded.source == EncodingSource::Detected {
            warnings.push(GameWarning::EncodingGuessed {
                encoding: decoded.encoding.to_owned(),
            });
        }
        if game.has_illegal() {
            warnings.push(GameWarning::IllegalMoves);
        }
        if reading.komi_unreadable {
            warnings.push(GameWarning::KomiUnreadable);
        }

        Ok(GameSession {
            game,
            others,
            index: 0,
            name: stem(name),
            rules: reading.rules,
            from_file: reading.rules,
            ru: trimmed(&root, "RU"),
            km: trimmed(&root, "KM"),
            revision: 0,
            warnings,
        })
    }

    /// Takes `next`'s place, keeping the revision increasing across games.
    pub fn replace(&mut self, next: GameSession) {
        let revision = self.revision + 1;
        *self = next;
        self.revision = revision;
    }

    fn node(&self) -> NodeId {
        self.game.main_line()[self.index]
    }

    fn last_index(&self) -> usize {
        self.game.main_line().len() - 1
    }

    /// What KataGo analyses now; `None` on an illegal node.
    pub fn position(&self) -> Option<Position> {
        self.game.position_at(self.node(), &self.rules)
    }

    /// Increases on every change; a client ignores an event older than what it has.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The current node's index on the main line.
    pub fn index(&self) -> usize {
        self.index
    }

    /// The board at the current node, with its capture counts.
    pub fn board(&self) -> &aji_core::game::Board {
        self.game.board_at(self.node())
    }

    pub fn rules(&self) -> AnalysisRules {
        self.rules
    }

    pub fn size(&self) -> BoardSize {
        self.game.size()
    }

    /// Each main-line node's LizzieYzy analysis as the file had it: the root's `LZOP`, every
    /// other node's `LZ` (design 5.11).
    pub fn lizzie(&self) -> Vec<Option<String>> {
        self.game
            .main_line()
            .iter()
            .enumerate()
            .map(|(i, &node)| {
                let id = if i == 0 { "LZOP" } else { "LZ" };
                self.game.sgf(node).first(id).map(str::to_owned)
            })
            .collect()
    }

    /// The position after the next main-line move, with that move, for the next-move hint;
    /// `None` at the end, before a node without a move, or when it is illegal.
    pub fn next(&self) -> Option<(Position, Move)> {
        let line = self.game.main_line();
        let &node = line.get(self.index + 1)?;
        let mv = self.game.last_move(node)?;
        Some((self.game.position_at(node, &self.rules)?, mv))
    }

    pub fn warnings(&self) -> &[GameWarning] {
        &self.warnings
    }

    /// Moves the current node. Returns whether it moved.
    pub fn navigate(&mut self, to: NavTarget) -> bool {
        let last = self.last_index();
        let index = match to {
            NavTarget::First => 0,
            NavTarget::Last => last,
            NavTarget::Previous => self.index.saturating_sub(1),
            NavTarget::Next => (self.index + 1).min(last),
            NavTarget::Move(n) => self
                .game
                .main_line()
                .iter()
                .position(|&node| self.game.move_number(node) >= n)
                .unwrap_or(last),
        };
        let moved = index != self.index;
        if moved {
            self.index = index;
            self.revision += 1;
        }
        moved
    }

    /// Sets the rules KataGo analyses with; `None` goes back to the file's reading. Returns
    /// whether they changed. Rules outside what the interface allows are refused.
    pub fn set_rules(&mut self, rules: Option<AnalysisRules>) -> Result<bool, AnalysisRules> {
        let rules = rules.unwrap_or(self.from_file);
        if !rules.is_valid() {
            return Err(rules);
        }
        let changed = rules != self.rules;
        if changed {
            self.rules = rules;
            self.revision += 1;
        }
        Ok(changed)
    }

    /// The board after `moves` from the current node; nothing changes.
    pub fn preview(&self, moves: &[Move]) -> Preview {
        self.game.preview(self.node(), moves)
    }

    /// The file name and UTF-8 text to save; `None` when the game holds nothing to save. The
    /// file's other games follow the open one.
    pub fn export(&self) -> Option<(String, String)> {
        self.export_with(&[])
    }

    /// `export`, with `lz[i]` written as main-line node `i`'s LizzieYzy analysis (`LZOP` on the
    /// root, `LZ` elsewhere), replacing what the file had there.
    pub fn export_with(&self, lz: &[Option<String>]) -> Option<(String, String)> {
        if self.game.is_empty() {
            return None;
        }
        let changed = self.rules != self.from_file;
        let mut tree = self.game.to_sgf(changed.then_some(&self.rules));
        for (i, node) in main_line_mut(&mut tree).into_iter().enumerate() {
            if let Some(Some(text)) = lz.get(i) {
                let id = if i == 0 { "LZOP" } else { "LZ" };
                node.props.retain(|p| p.id != id);
                node.push(id, [text.clone()]);
            }
        }
        let mut trees = vec![tree];
        // The whole file is written in UTF-8, so a game that names its encoding now names that.
        trees.extend(self.others.iter().cloned().map(|mut tree| {
            if let Some(ca) = tree
                .nodes
                .first_mut()
                .and_then(|root| root.props.iter_mut().find(|p| p.id == "CA"))
            {
                ca.values = vec!["UTF-8".to_owned()];
            }
            tree
        }));
        let name = format!("{}.sgf", self.name.as_deref().unwrap_or("game"));
        Some((name, aji_core::sgf::write_sgf(&trees)))
    }

    /// Every main-line node, first to last.
    pub fn line(&self) -> Vec<LineNode> {
        self.game
            .main_line()
            .iter()
            .map(|&node| {
                let position = self.game.position_at(node, &self.rules);
                LineNode {
                    move_number: self.game.move_number(node),
                    mover: self.game.last_color(node),
                    mv: self.game.last_move(node),
                    key: position.as_ref().map(Position::key),
                    position,
                }
            })
            .collect()
    }

    /// The next main-line move, skipping nodes without one as long as they leave the board as it
    /// is (comments); a node that changes it (setup stones) ends the search.
    fn next_move(&self) -> Option<Move> {
        let line = self.game.main_line();
        let here = self.game.board_at(self.node()).stones();
        for &node in &line[self.index + 1..] {
            if let Some(mv) = self.game.last_move(node) {
                return Some(mv);
            }
            if self.game.board_at(node).stones() != here {
                return None;
            }
        }
        None
    }

    pub fn snapshot(&self) -> GameSnapshot {
        let node = self.node();
        let board = self.game.board_at(node);
        let (black, white) = board.captures();
        let last = *self.game.main_line().last().expect("never empty");
        GameSnapshot {
            revision: self.revision,
            name: self.name.clone(),
            info: self.game.info().clone(),
            rules: RulesState {
                current: self.rules,
                from_file: self.from_file,
                changed: self.rules != self.from_file,
                ru: self.ru.clone(),
                km: self.km.clone(),
            },
            size: self.game.size().get(),
            stones: board.stones(),
            last_move: self.game.last_move(node),
            next_color: self.game.to_play(node),
            move_number: self.game.move_number(node),
            line_index: self.index as u32,
            next_move: self.next_move(),
            main_line_length: self.game.move_number(last),
            at_start: self.index == 0,
            at_end: self.index == self.last_index(),
            illegal: self.illegal(),
            captures: [black, white],
            position_key: self.position().map(|p| p.key()),
            has_moves: !self.game.is_empty(),
        }
    }

    fn illegal(&self) -> Option<Illegal> {
        self.game.illegal(self.node())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems() {
        assert_eq!(stem("a.sgf").as_deref(), Some("a"));
        assert_eq!(stem("三星杯.SGF").as_deref(), Some("三星杯"));
        assert_eq!(stem("a.txt").as_deref(), Some("a.txt"));
        assert_eq!(stem(".sgf"), None);
        assert_eq!(stem("é").as_deref(), Some("é"));
    }

    #[test]
    fn new_games_are_five_to_nineteen() {
        for size in [5, 9, 13, 19] {
            assert!(
                GameSession::new(size, AnalysisRules::Chinese).is_ok(),
                "{size}"
            );
        }
        for size in [0, 4, 20, 25] {
            assert_eq!(
                GameSession::new(size, AnalysisRules::Chinese).err(),
                Some(OpenError::UnsupportedSize {
                    width: size,
                    height: size
                })
            );
        }
    }

    #[test]
    fn every_saved_game_says_utf8() {
        // Two GBK games, each declaring it; 丁浩 is B6A1 BAC6 in GBK.
        let mut bytes = Vec::new();
        for game in 0..2 {
            bytes.extend_from_slice(b"(;GM[1]FF[4]CA[gb2312]SZ[19]PB[");
            bytes.extend_from_slice(b"\xB6\xA1\xBA\xC6");
            bytes.extend_from_slice(format!("]GN[{game}];B[pd])").as_bytes());
        }
        let session = GameSession::open("two.sgf", &bytes, AnalysisRules::Chinese).unwrap();
        let (_, text) = session.export().unwrap();
        assert_eq!(text.matches("CA[UTF-8]").count(), 2, "{text}");
        assert!(!text.to_lowercase().contains("gb2312"), "{text}");
        assert_eq!(text.matches("丁浩").count(), 2, "{text}");
    }

    #[test]
    fn replace_keeps_the_revision_increasing() {
        let mut session = GameSession::new(19, AnalysisRules::Chinese).unwrap();
        session.revision = 7;
        session.replace(GameSession::new(9, AnalysisRules::Chinese).unwrap());
        assert_eq!(session.snapshot().revision, 8);
        assert_eq!(session.snapshot().size, 9);
    }

    #[test]
    fn the_start_position_is_the_m2_default() {
        let session = GameSession::new(19, AnalysisRules::Chinese).unwrap();
        let m2 = Position::empty(
            BoardSize::NINETEEN,
            aji_core::Rules::Chinese,
            aji_core::Komi::new(7.5).unwrap(),
        );
        assert_eq!(session.position(), Some(m2));
    }

    /// Setup on the root, then B, W, a comment-only node and two White moves in a row's worth
    /// of colours: movers come from the nodes, never from alternation.
    const LINE: &[u8] = b"(;GM[1]FF[4]SZ[19]AB[dd];B[pd];W[dp];C[note];W[pp])";

    fn play(x: u8, y: u8) -> Move {
        Move::Play(aji_core::Point { x, y })
    }

    #[test]
    fn line_has_a_node_per_main_line_node() {
        let session = GameSession::open("line.sgf", LINE, AnalysisRules::Chinese).unwrap();
        let line = session.line();
        let numbers: Vec<u32> = line.iter().map(|n| n.move_number).collect();
        assert_eq!(numbers, [0, 1, 2, 2, 3]);
        let movers: Vec<Option<Color>> = line.iter().map(|n| n.mover).collect();
        assert_eq!(
            movers,
            [
                None,
                Some(Color::Black),
                Some(Color::White),
                None,
                Some(Color::White)
            ]
        );
        assert_eq!(line[1].mv, Some(play(15, 3)));
        assert_eq!(line[3].mv, None);
        assert_eq!(line[2].key, session_key_at(&session, 2));
        // A comment-only node has the same position as its parent.
        assert_eq!(line[3].key, line[2].key);
    }

    fn session_key_at(session: &GameSession, index: usize) -> Option<aji_core::PositionKey> {
        let node = session.game.main_line()[index];
        session
            .game
            .position_at(node, &session.rules)
            .map(|p| p.key())
    }

    #[test]
    fn line_index_and_next_move_follow_navigation() {
        let mut session = GameSession::open("line.sgf", LINE, AnalysisRules::Chinese).unwrap();
        let s = session.snapshot();
        assert_eq!(s.line_index, 0);
        assert_eq!(s.next_move, Some(play(15, 3)));
        session.navigate(NavTarget::Move(2));
        let s = session.snapshot();
        assert_eq!(s.line_index, 2);
        // The comment-only node is skipped.
        assert_eq!(s.next_move, Some(play(15, 15)));
        session.navigate(NavTarget::Last);
        let s = session.snapshot();
        assert_eq!(s.line_index, 4);
        assert_eq!(s.next_move, None);
    }

    #[test]
    fn next_move_stops_at_a_node_that_changes_the_board_without_a_move() {
        let text = b"(;GM[1]FF[4]SZ[19];B[pd];AW[dd];W[dp])";
        let mut session = GameSession::open("setup.sgf", text, AnalysisRules::Chinese).unwrap();
        session.navigate(NavTarget::Move(1));
        assert_eq!(session.snapshot().next_move, None);
    }
}
