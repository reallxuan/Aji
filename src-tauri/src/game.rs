//! The open game (design 5.4): one game at a time, its current node and line, the rules
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

/// Where `gameNavigate` goes in the record.
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
    Node(u32),
    PreviousSibling,
    NextSibling,
    BranchPoint,
    MainLine,
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
    current: NodeId,
    tip: NodeId,
    /// Remember the old path across edits, including when a removed subtree loses its parent.
    selected_line: Vec<NodeId>,
    pub line_revision: u64,
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

/// One current-line node, for the trend graph (design 5.3).
#[derive(Debug, Clone, PartialEq)]
pub struct LineNode {
    pub node: NodeId,
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
            current: game.root(),
            tip: game.root(),
            selected_line: game.main_line().to_vec(),
            line_revision: 0,
            game,
            others: Vec::new(),
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
            current: game.root(),
            tip: game.root(),
            selected_line: game.main_line().to_vec(),
            line_revision: 0,
            game,
            others,
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
        let line_revision = self.line_revision + 1;
        *self = next;
        self.line_revision = line_revision;
        self.revision = revision;
    }

    pub fn current_line(&self) -> Vec<NodeId> {
        self.selected_line.clone()
    }

    pub fn line_index(&self) -> usize {
        self.selected_line
            .iter()
            .position(|&id| id == self.current)
            .expect("current belongs to the line")
    }

    fn refresh_line(&mut self) {
        let line = self.game.line_through(self.tip);
        if self.selected_line != line {
            self.selected_line = line;
            self.line_revision += 1;
        }
    }

    pub fn retip_after_detach(&mut self) {
        let old_index = self.line_index();
        if !self.game.is_attached(self.current) {
            self.current = self.selected_line[..old_index]
                .iter()
                .rev()
                .copied()
                .find(|&id| self.game.is_attached(id))
                .unwrap_or(self.game.root());
        }
        if !self.game.is_attached(self.tip) {
            self.tip = self
                .selected_line
                .iter()
                .rev()
                .copied()
                .find(|&id| self.game.is_attached(id))
                .unwrap_or(self.game.root());
        }
        self.refresh_line();
    }

    pub fn trim(&mut self) {
        self.game.trim(&self.game.path_to(self.current));
    }

    pub fn open_at_end(&mut self) {
        let node = self
            .selected_line
            .iter()
            .rev()
            .copied()
            .find(|&id| self.game.last_move(id).is_some())
            .unwrap_or(self.game.root());
        self.navigate(NavTarget::Node(node as u32));
    }

    /// What KataGo analyses now; `None` on an illegal node.
    pub fn position(&self) -> Option<Position> {
        self.game.position_at(self.current, &self.rules)
    }

    /// Increases on every change; a client ignores an event older than what it has.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The board at the current node, with its capture counts.
    pub fn board(&self) -> &aji_core::game::Board {
        self.game.board_at(self.current)
    }

    pub fn rules(&self) -> AnalysisRules {
        self.rules
    }

    pub fn size(&self) -> BoardSize {
        self.game.size()
    }

    /// Each selected node's LizzieYzy analysis as the file had it: the root's `LZOP`, every
    /// other node's `LZ` (design 5.11).
    pub fn lizzie(&self) -> Vec<Option<String>> {
        self.selected_line
            .iter()
            .enumerate()
            .map(|(i, &node)| {
                let id = if i == 0 { "LZOP" } else { "LZ" };
                self.game.sgf(node).first(id).map(str::to_owned)
            })
            .collect()
    }

    /// The position after the next current-line move, with that move, for the next-move hint;
    /// `None` at the end, across a setup change, or when the move is illegal.
    pub fn next(&self) -> Option<(Position, Move)> {
        let (node, mv) = self.next_move()?;
        Some((self.game.position_at_uncached(node, &self.rules)?, mv))
    }

    pub fn warnings(&self) -> &[GameWarning] {
        &self.warnings
    }

    /// Moves the current node. Returns whether it moved.
    pub fn navigate(&mut self, to: NavTarget) -> bool {
        let line = &self.selected_line;
        let index = self.line_index();
        let last = line.len() - 1;
        let target = match to {
            NavTarget::First => line[0],
            NavTarget::Last => line[last],
            NavTarget::Previous => line[index.saturating_sub(1)],
            NavTarget::Next => line[(index + 1).min(last)],
            NavTarget::Move(0) => line[0],
            NavTarget::Move(n) => line
                .iter()
                .copied()
                .filter(|&id| self.game.last_move(id).is_some())
                .nth((n - 1) as usize)
                .unwrap_or(line[last]),
            NavTarget::Node(id) if self.game.is_attached(id as usize) => id as usize,
            NavTarget::Node(_) => self.current,
            NavTarget::PreviousSibling | NavTarget::NextSibling => self
                .game
                .parent(self.current)
                .and_then(|parent| {
                    let siblings = self.game.children(parent);
                    let index = siblings.iter().position(|&id| id == self.current)?;
                    let offset = if to == NavTarget::NextSibling { 1 } else { -1 };
                    siblings.get(index.checked_add_signed(offset)?).copied()
                })
                .unwrap_or(self.current),
            NavTarget::BranchPoint => line[..=index]
                .windows(2)
                .rev()
                .find_map(|pair| {
                    (self.game.children(pair[0]).first() != Some(&pair[1])).then_some(pair[0])
                })
                .unwrap_or(self.current),
            NavTarget::MainLine => line
                .iter()
                .zip(self.game.main_line())
                .take(index + 1)
                .take_while(|(a, b)| a == b)
                .last()
                .map(|(&id, _)| id)
                .unwrap_or(self.game.root()),
        };
        let old_revision = self.line_revision;
        if (to == NavTarget::MainLine && line != self.game.main_line()) || !line.contains(&target) {
            self.tip = target;
            self.refresh_line();
        }
        let moved = self.current != target || self.line_revision != old_revision;
        self.current = target;
        if moved {
            self.revision += 1;
        }
        self.trim();
        moved
    }

    /// Sets the rules KataGo analyses with; `None` goes back to the file's reading. Returns
    /// whether their effect changed. Rules outside what the interface allows are refused.
    pub fn set_rules(&mut self, rules: Option<AnalysisRules>) -> Result<bool, AnalysisRules> {
        let rules = rules.unwrap_or(self.from_file);
        if !rules.is_valid() {
            return Err(rules);
        }
        let changed = !rules.same_effect(&self.rules);
        if self.rules != rules {
            self.rules = rules;
            self.revision += 1;
        }
        Ok(changed)
    }

    /// The board after `moves` from the current node; nothing changes.
    pub fn preview(&self, moves: &[Move]) -> Preview {
        self.game.preview(self.current, moves)
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
        let changed = !self.rules.same_effect(&self.from_file);
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

    /// Every node of the selected line, first to last.
    pub fn line(&self) -> Vec<LineNode> {
        self.line_nodes(&self.selected_line)
    }

    /// The main-line analysis written to the file's main-line nodes.
    pub fn main_line_analysis(&self) -> Vec<LineNode> {
        self.line_nodes(self.game.main_line())
    }

    fn line_nodes(&self, nodes: &[NodeId]) -> Vec<LineNode> {
        nodes
            .iter()
            .map(|&node| {
                let position = self.game.position_at(node, &self.rules);
                LineNode {
                    node,
                    move_number: self.game.move_number(node),
                    mover: self.game.last_color(node),
                    mv: self.game.last_move(node),
                    key: position.as_ref().map(Position::key),
                    position,
                }
            })
            .collect()
    }

    /// The next current-line move, skipping nodes without one as long as they leave the board as it
    /// is (comments); a node that changes it (setup stones) ends the search.
    fn next_move(&self) -> Option<(NodeId, Move)> {
        self.game
            .next_move_on_line(self.current, &self.selected_line[self.line_index() + 1..])
    }

    pub fn snapshot(&self) -> GameSnapshot {
        let node = self.current;
        let board = self.game.board_at(node);
        let (black, white) = board.captures();
        let index = self.line_index();
        GameSnapshot {
            revision: self.revision,
            name: self.name.clone(),
            info: self.game.info().clone(),
            rules: RulesState {
                current: self.rules,
                from_file: self.from_file,
                changed: !self.rules.same_effect(&self.from_file),
                ru: self.ru.clone(),
                km: self.km.clone(),
            },
            size: self.game.size().get(),
            stones: board.stones(),
            last_move: self.game.last_move(node),
            next_color: self.game.to_play(node),
            move_number: self.game.move_number(node),
            line_index: index as u32,
            next_move: self.next_move().map(|(_, mv)| mv),
            main_line_length: self
                .selected_line
                .iter()
                .filter(|&&id| self.game.last_move(id).is_some())
                .count() as u32,
            at_start: index == 0,
            at_end: index + 1 == self.selected_line.len(),
            illegal: self.illegal(),
            captures: [black, white],
            position_key: self.position().map(|p| p.key()),
            has_moves: !self.game.is_empty(),
        }
    }

    fn illegal(&self) -> Option<Illegal> {
        self.game.illegal(self.current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Main 0-1-2-3, variation 1-4-5 with a nested variation 4-6.
    fn branches() -> GameSession {
        GameSession::open(
            "branches.sgf",
            b"(;SZ[9];B[aa](;W[bb];B[cc])(;W[dd](;B[ee])(;B[ff])))",
            AnalysisRules::Chinese,
        )
        .unwrap()
    }

    #[test]
    fn going_back_before_a_branch_keeps_the_variation() {
        let mut s = branches();
        s.navigate(NavTarget::Node(6));
        s.navigate(NavTarget::First);
        assert_eq!(s.current_line(), [0, 1, 4, 6]);
        assert_eq!(s.line_index(), 0);
    }

    #[test]
    fn next_after_the_branch_point_returns_into_the_variation() {
        let mut s = branches();
        s.navigate(NavTarget::Node(4));
        s.navigate(NavTarget::Previous);
        s.navigate(NavTarget::Next);
        assert_eq!(s.snapshot().last_move, Some(play(3, 3)));
    }

    #[test]
    fn entering_another_node_moves_the_tip() {
        let mut s = branches();
        s.navigate(NavTarget::Node(6));
        assert!(s.navigate(NavTarget::Node(2)));
        assert_eq!(s.current_line(), [0, 1, 2, 3]);
        assert!(!s.navigate(NavTarget::Node(u32::MAX)));
        s.open_at_end();
        assert_eq!(s.current, 3);
    }

    #[test]
    fn siblings_switch_continuations_of_the_previous_move() {
        let mut s = branches();
        s.navigate(NavTarget::Node(2));
        assert!(s.navigate(NavTarget::NextSibling));
        assert_eq!(s.current, 4);
        assert!(!s.navigate(NavTarget::NextSibling));
        assert!(s.navigate(NavTarget::PreviousSibling));
        assert_eq!(s.current, 2);
    }

    #[test]
    fn branch_point_and_main_line_targets() {
        let mut s = branches();
        s.navigate(NavTarget::Node(6));
        s.navigate(NavTarget::BranchPoint);
        assert_eq!(s.current, 4);
        assert_eq!(s.tip, 6);
        s.navigate(NavTarget::MainLine);
        assert_eq!(s.current, 1);
        assert_eq!(s.current_line(), [0, 1, 2, 3]);
    }

    #[test]
    fn main_line_only_retips_when_leaving_a_selected_variation() {
        let mut s = branches();
        s.navigate(NavTarget::Node(4));
        s.navigate(NavTarget::PreviousSibling);
        s.navigate(NavTarget::First);
        assert!(!s.navigate(NavTarget::MainLine));
        assert_eq!(s.tip, 2);
        s.navigate(NavTarget::Node(6));
        s.navigate(NavTarget::First);
        assert!(s.navigate(NavTarget::MainLine));
        assert_eq!(s.current_line(), [0, 1, 2, 3]);
    }

    #[test]
    fn move_n_follows_the_current_line() {
        let mut s = branches();
        s.navigate(NavTarget::Node(6));
        s.navigate(NavTarget::Move(2));
        assert_eq!(s.current, 4);
        s.navigate(NavTarget::Move(100));
        assert_eq!(s.line()[s.line_index()].node, 6);
    }

    #[test]
    fn line_revision_changes_only_with_the_line() {
        let mut s = branches();
        let rev = s.line_revision;
        s.navigate(NavTarget::Next);
        s.navigate(NavTarget::Node(2));
        assert_eq!(s.line_revision, rev);
        s.navigate(NavTarget::NextSibling);
        assert_eq!(s.line_revision, rev + 1);
        s.navigate(NavTarget::Node(5));
        assert_eq!(s.line_revision, rev + 1);
    }

    #[test]
    fn detaching_the_variation_recovers_its_old_ancestors() {
        let mut s = branches();
        s.navigate(NavTarget::Node(6));
        s.game
            .edit(&aji_core::game::Edit::Delete { node: 4 })
            .unwrap();
        s.retip_after_detach();
        assert_eq!((s.current, s.tip), (1, 1));
        assert_eq!(s.current_line(), [0, 1, 2, 3]);
    }

    #[test]
    fn next_move_skips_pl_only_nodes() {
        let s = GameSession::open(
            "pl.sgf",
            b"(;SZ[9];C[note];PL[W];W[cc])",
            AnalysisRules::Chinese,
        )
        .unwrap();
        assert_eq!(s.snapshot().next_move, Some(play(2, 2)));
        assert_eq!(
            s.next(),
            Some((s.game.position_at(3, &s.rules).unwrap(), play(2, 2)))
        );
    }

    #[test]
    fn opening_at_end_skips_trailing_comments() {
        let mut s = GameSession::open(
            "end.sgf",
            b"(;SZ[9];B[bb];W[];C[note])",
            AnalysisRules::Chinese,
        )
        .unwrap();
        s.open_at_end();
        assert_eq!(s.current, 2);
        s.navigate(NavTarget::Last);
        assert_eq!(s.current, 3);
    }

    #[test]
    fn opening_at_end_of_a_moveless_record_stays_at_root() {
        let mut s = GameSession::open(
            "empty.sgf",
            b"(;SZ[9];PL[W];C[note])",
            AnalysisRules::Chinese,
        )
        .unwrap();
        s.open_at_end();
        assert_eq!(s.current, s.game.root());
    }

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
    fn equivalent_rules_update_the_selected_form() {
        let mut session = GameSession::new(19, AnalysisRules::Chinese).unwrap();
        let revision = session.snapshot().revision;
        let rules = AnalysisRules::Custom {
            komi: aji_core::Komi::new(7.5).unwrap(),
            scoring: aji_core::game::Scoring::Area,
            details: None,
        };
        assert_eq!(session.set_rules(Some(rules)), Ok(false));
        let snapshot = session.snapshot();
        assert_eq!(snapshot.rules.current, rules);
        assert!(!snapshot.rules.changed);
        assert_eq!(snapshot.revision, revision + 1);
    }

    #[test]
    fn the_start_position_is_the_m2_default() {
        let session = GameSession::new(19, AnalysisRules::Chinese).unwrap();
        let m2 = Position::empty(
            BoardSize::NINETEEN,
            aji_core::Rules::Chinese.into(),
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
        assert_eq!(session.next(), None);
    }
}
