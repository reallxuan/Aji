//! The open game (design 5.4): one game at a time, its current node and line, the rules
//! KataGo analyses it with, and what reading the file repaired. `service` holds it behind a
//! mutex and tells the engine about every change.

use std::collections::{HashMap, HashSet};

use aji_core::game::{
    AnalysisRules, Change, Edit, EditError, Game, GameError, Illegal, InfoField, Mark, NodeId, Op,
    PositionScope, Preview,
};
use aji_core::sgf::{
    Encoded, EncodingSource, LzData, SgfError, SgfNode, SgfTree, SgfWarning, decode, encode_sgf,
    parse_lz, parse_sgf,
};
use aji_core::{BoardSize, Color, Move, Point, Position, PositionKey};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::history::{EntryKind, History, Spot};
use crate::job::JobScope;
use crate::protocol::{
    Continuation, ExportOptions, ExportScope, GameSnapshot, GameTree, MarkAt, Placed, TreeNode,
};

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

/// An edit requested by the interface. Node IDs belong to the open record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum SessionEdit {
    Play {
        mv: Move,
    },
    Pass,
    InsertMove {
        color: Color,
        mv: Move,
    },
    DeleteBranch {
        node: u32,
    },
    DeleteFrom {
        node: u32,
    },
    Promote {
        node: u32,
    },
    MoveUp {
        node: u32,
    },
    SetComment {
        node: u32,
        text: Option<String>,
    },
    SetMark {
        node: u32,
        point: Point,
        mark: Option<Mark>,
    },
    ClearMarks {
        node: u32,
    },
    SetupStone {
        point: Point,
        stone: Option<Color>,
    },
    MoveStone {
        from: Point,
        to: Point,
    },
    SetToPlay {
        color: Color,
    },
    Flatten,
    SetInfo {
        field: InfoField,
        value: Option<String>,
    },
    SetRules {
        rules: Option<AnalysisRules>,
    },
    TryoutStart,
    TryoutEnd,
    TryoutKeep {
        node: u32,
    },
    /// Puts the current node's own move on `to`, keeping every later move (move-last-move
    /// design). Refused with `LaterMovesIllegal` when that makes later moves illegal, unless
    /// `allow_illegal`.
    #[serde(rename_all = "camelCase")]
    MoveLastMove {
        to: Point,
        allow_illegal: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Illegal(Illegal),
    EndTryoutFirst,
    NoSuchNode,
    InvalidRules,
    /// How many later moves, legal now, the edit would make illegal.
    LaterMovesIllegal(u32),
}

impl From<EditError> for Refusal {
    fn from(error: EditError) -> Self {
        match error {
            EditError::Illegal(reason) => Self::Illegal(reason),
            EditError::NoSuchNode | EditError::NotTryout => Self::NoSuchNode,
            EditError::LaterMovesIllegal(count) => Self::LaterMovesIllegal(count),
        }
    }
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
    /// The file was read using an encoding guessed from its contents.
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

struct Source {
    encoding: &'static str,
    ca: Option<String>,
    needs_save_as: bool,
}

impl Source {
    fn utf8() -> Self {
        Self {
            encoding: "UTF-8",
            ca: Some("UTF-8".to_owned()),
            needs_save_as: false,
        }
    }
}

fn clean_node(node: &mut SgfNode) {
    node.props
        .retain(|p| !matches!(p.id.as_str(), "C" | "LZ" | "LZOP" | "LZ2" | "LZOP2"));
}

/// Keep other games' existing declarations accurate when the whole file becomes UTF-8.
fn declare_utf8(tree: &mut SgfTree) {
    if let Some(ca) = tree
        .nodes
        .first_mut()
        .and_then(|root| root.props.iter_mut().find(|p| p.id == "CA"))
    {
        ca.values = vec!["UTF-8".to_owned()];
    }
}

/// The open game and where the user is in it.
pub struct GameSession {
    game: Game,
    history: History,
    tryout: Option<NodeId>,
    /// The file's other games, written back on export.
    others: Vec<SgfTree>,
    current: NodeId,
    tip: NodeId,
    /// Remember the old path across edits, including when a removed subtree loses its parent.
    selected_line: Vec<NodeId>,
    pub(crate) game_revision: u64,
    pub line_revision: u64,
    pub tree_revision: u64,
    source: Source,
    /// Flatten copies the source root properties even as its node ID changes.
    source_root: NodeId,
    /// The original position of each parseable primary analysis value. An illegal node has no key.
    source_lz: HashMap<NodeId, Option<PositionKey>>,
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

fn source_annotation(game: &Game, node: NodeId) -> Option<&str> {
    game.sgf(node)
        .first(if node == game.root() { "LZOP" } else { "LZ" })
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

/// One node in a depth-first traversal of the selected line or the kept tree.
#[derive(Debug, Clone, PartialEq)]
pub struct LineNode<P = Option<Position>> {
    /// Parent slot in the same traversal, including across variations.
    pub parent: Option<usize>,
    pub node: NodeId,
    pub move_number: u32,
    pub mover: Option<Color>,
    pub to_play: Option<Color>,
    pub tryout: bool,
    pub mv: Option<Move>,
    /// `None` on an illegal node.
    pub key: Option<PositionKey>,
    /// Jobs retain the legal engine position. Trend nodes carry only metadata (`()`).
    pub position: P,
}

/// A rules edit affects every position. For an in-place record edit, compare the
/// properties used by replay and the try-out flag used by job estimates. Structural edits
/// are covered by the line's node IDs.
fn edited_trend_nodes(kind: &EntryKind, line: &[NodeId]) -> bool {
    let EntryKind::Record(change) = kind else {
        return true;
    };
    let selected = std::cell::LazyCell::new(|| line.iter().copied().collect::<HashSet<_>>());
    change
        .forward
        .iter()
        .zip(change.inverse.iter().rev())
        .any(|(forward, inverse)| {
            if let Op::SetTryout { node, .. } = forward {
                return selected.contains(node);
            }
            let (Op::SetProps { node, props: after }, Op::SetProps { props: before, .. }) =
                (forward, inverse)
            else {
                return false;
            };
            // Core replay uses the first property with each identifier, even in unusual files.
            ["AB", "AW", "AE", "PL", "B", "W", "HA"]
                .iter()
                .any(|&id| before.iter().find(|p| p.id == id) != after.iter().find(|p| p.id == id))
                && selected.contains(node)
        })
}

/// Record links, the try-out bit, comment presence and the refreshed legality index
/// determine whether clients need a new tree. The test is symmetric across undo/redo.
fn edited_tree(change: &Change, old_illegal: &[NodeId], game: &Game) -> bool {
    fn has_comment(props: &[aji_core::sgf::SgfProp]) -> bool {
        props
            .iter()
            .find(|p| p.id == "C")
            .and_then(|p| p.values.first())
            .is_some_and(|s| !s.is_empty())
    }
    // The tree shows each node's move, so a move put on another point is a new tree.
    fn moved(props: &[aji_core::sgf::SgfProp]) -> Option<(&str, Option<&String>)> {
        props
            .iter()
            .find(|p| p.id == "B" || p.id == "W")
            .map(|p| (p.id.as_str(), p.values.first()))
    }
    old_illegal != game.illegal_nodes()
        || change
            .forward
            .iter()
            .zip(change.inverse.iter().rev())
            .any(|(op, inverse)| match (op, inverse) {
                (Op::SetProps { props, .. }, Op::SetProps { props: old, .. }) => {
                    has_comment(props) != has_comment(old) || moved(props) != moved(old)
                }
                _ => true,
            })
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
            history: History::default(),
            tryout: None,
            source_root: game.root(),
            current: game.root(),
            tip: game.root(),
            selected_line: game.main_line().to_vec(),
            game_revision: 0,
            line_revision: 0,
            tree_revision: 0,
            game,
            others: Vec::new(),
            name: None,
            rules: reading.rules,
            from_file: reading.rules,
            ru: None,
            km: None,
            revision: 0,
            source: Source::utf8(),
            source_lz: HashMap::new(),
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
        Self::open_with_analysis(name, bytes, default_rules, |_, _, _, _| {})
    }

    /// While opening, hand each readable source annotation to the caller with its original position.
    pub fn open_with_analysis(
        name: &str,
        bytes: &[u8],
        default_rules: AnalysisRules,
        mut import: impl FnMut(&LzData, PositionKey, BoardSize, Color),
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

        let mut session = GameSession {
            history: History::default(),
            tryout: None,
            source_root: game.root(),
            current: game.root(),
            tip: game.root(),
            selected_line: game.main_line().to_vec(),
            game_revision: 0,
            line_revision: 0,
            tree_revision: 0,
            game,
            others,
            name: stem(name),
            rules: reading.rules,
            from_file: reading.rules,
            ru: trimmed(&root, "RU"),
            km: trimmed(&root, "KM"),
            revision: 0,
            source_lz: HashMap::new(),
            source: Source {
                encoding: decoded.source_encoding(bytes),
                ca: root.first("CA").map(str::to_owned),
                needs_save_as: warnings
                    .iter()
                    .any(|w| matches!(w, GameWarning::Truncated | GameWarning::Repaired)),
            },
            warnings,
        };
        let size = session.size();
        let points = usize::from(size.get()).pow(2);
        let annotation = |id| source_annotation(&session.game, id);
        if session.game.kept_nodes().any(|id| annotation(id).is_some()) {
            session.game.visit_positions(
                &session.rules,
                PositionScope::Kept,
                |id, _, _, position| {
                    if let Some(data) = annotation(id).and_then(|text| parse_lz(text, points)) {
                        let key = position.map(Position::key);
                        session.source_lz.insert(id, key);
                        if let Some((position, key)) = position.zip(key) {
                            import(&data, key, size, position.to_move());
                        }
                    }
                },
            );
        }
        Ok(session)
    }

    /// Takes `next`'s place, keeping the revision increasing across games.
    pub fn replace(&mut self, next: GameSession) {
        let revision = self.revision + 1;
        let line_revision = self.line_revision + 1;
        let tree_revision = self.tree_revision + 1;
        *self = next;
        self.game_revision = revision;
        self.tree_revision = tree_revision;
        self.line_revision = line_revision;
        self.revision = revision;
    }

    pub fn current_node(&self) -> NodeId {
        self.current
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

    fn refresh_line(&mut self, positions_changed: bool) {
        let line = self.game.line_through(self.tip);
        if positions_changed || self.selected_line != line {
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
        self.refresh_line(false);
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

    /// Original analysis values keyed by their attached record nodes.
    pub fn lizzie(&self) -> HashMap<NodeId, String> {
        self.game
            .kept_nodes()
            .filter_map(|id| Some((id, source_annotation(&self.game, id)?.to_owned())))
            .collect()
    }

    /// Retain only keys and sides to move when querying the cache for many nodes.
    pub fn analysis_keys(&self, scope: PositionScope<'_>) -> Vec<(NodeId, PositionKey, Color)> {
        let mut keys = Vec::new();
        self.game
            .visit_positions(&self.rules, scope, |id, _, _, position| {
                if let Some(position) = position {
                    keys.push((id, position.key(), position.to_move()));
                }
            });
        keys
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
            self.refresh_line(false);
        }
        let moved = self.current != target || self.line_revision != old_revision;
        self.current = target;
        if moved {
            self.revision += 1;
        }
        self.trim();
        moved
    }

    fn spot(&self) -> Spot {
        Spot {
            current: self.current,
            tip: self.tip,
            tryout: self.tryout,
        }
    }

    fn restore(&mut self, spot: Spot, positions_changed: bool) {
        self.current = spot.current;
        self.tip = spot.tip;
        self.tryout = spot.tryout;
        self.refresh_line(positions_changed);
        self.trim();
        self.revision += 1;
    }

    fn push(&mut self, kind: EntryKind, kept: bool, before: Spot) {
        let discarded = self.history.push(kind, kept, before, self.spot());
        self.history.release_discarded(&mut self.game, discarded);
    }

    fn variation_start(&self, node: u32) -> Result<NodeId, Refusal> {
        let mut node = node as NodeId;
        if self.game.is_attached(node) {
            while let Some(parent) = self.game.parent(node) {
                if self.game.children(parent).first() != Some(&node) {
                    return Ok(node);
                }
                node = parent;
            }
        }
        Err(Refusal::NoSuchNode)
    }

    fn check_tryout(&self, edit: &SessionEdit) -> Result<(), Refusal> {
        use SessionEdit::*;
        match *edit {
            TryoutEnd | Pass | Play { .. } => Ok(()),
            // Only a try-out move may be moved during try-out.
            MoveLastMove { .. } if self.game.is_tryout(self.current) => Ok(()),
            SetComment { node, .. } | DeleteFrom { node } | TryoutKeep { node } => {
                let id = node as NodeId;
                if !self.game.is_attached(id) {
                    return Err(Refusal::NoSuchNode);
                }
                if self.game.is_tryout(id) {
                    Ok(())
                } else {
                    Err(Refusal::EndTryoutFirst)
                }
            }
            _ => Err(Refusal::EndTryoutFirst),
        }
    }

    fn has_tryout_nodes(&self) -> bool {
        let mut stack = vec![self.game.root()];
        while let Some(node) = stack.pop() {
            if self.game.is_tryout(node) {
                return true;
            }
            stack.extend_from_slice(self.game.children(node));
        }
        false
    }

    fn edit_rules(&mut self, rules: Option<AnalysisRules>) -> Result<bool, Refusal> {
        let after = rules.unwrap_or(self.from_file);
        if !after.is_valid() {
            return Err(Refusal::InvalidRules);
        }
        if self.rules == after {
            return Ok(false);
        }
        let old_rules = self.rules;
        self.rules = after;
        if !old_rules.same_effect(&after) {
            self.line_revision += 1;
            self.push(
                EntryKind::Rules {
                    before: old_rules,
                    after,
                },
                true,
                self.spot(),
            );
        }
        self.revision += 1;
        Ok(true)
    }

    /// Returns whether the session changed, including cursor or selected rules form changes.
    pub fn edit(&mut self, edit: SessionEdit) -> Result<bool, Refusal> {
        use SessionEdit::*;
        let before = self.spot();
        let at = self.current;
        if self.tryout.is_some() {
            self.check_tryout(&edit)?;
        }
        let record = match edit {
            TryoutStart => {
                self.tryout = Some(at);
                self.push(
                    EntryKind::Record(Change {
                        forward: Vec::new(),
                        inverse: Vec::new(),
                        focus: at,
                    }),
                    false,
                    before,
                );
                self.revision += 1;
                return Ok(true);
            }
            TryoutEnd if self.tryout.is_none() => return Ok(false),
            TryoutEnd => Edit::DropTryout,
            TryoutKeep { node } => Edit::KeepTryout {
                node: node as NodeId,
            },
            SetRules { rules } => return self.edit_rules(rules),
            Play { mv } => self.play_edit(mv),
            Pass => self.play_edit(Move::Pass),
            InsertMove { color, mv } => Edit::InsertMove { at, color, mv },
            DeleteBranch { node } => Edit::Delete {
                node: self.variation_start(node)?,
            },
            DeleteFrom { node } => Edit::Delete {
                node: node as NodeId,
            },
            Promote { node } => Edit::Promote {
                node: self.variation_start(node)?,
            },
            MoveUp { node } => Edit::MoveUp {
                node: self.variation_start(node)?,
            },
            SetComment { node, text } => Edit::SetComment {
                node: node as NodeId,
                text,
            },
            SetMark { node, point, mark } => Edit::SetMark {
                node: node as NodeId,
                point,
                mark,
            },
            ClearMarks { node } => Edit::ClearMarks {
                node: node as NodeId,
            },
            SetupStone { point, stone } => Edit::SetupStone { at, point, stone },
            MoveStone { from, to } => Edit::MoveStone { at, from, to },
            MoveLastMove { to, allow_illegal } => Edit::MovePlay {
                node: at,
                to,
                allow_illegal,
            },
            SetToPlay { color } => Edit::SetToPlay { at, color },
            Flatten => Edit::Flatten { at },
            SetInfo { field, value } => Edit::SetInfo { field, value },
        };

        self.edit_record(record, before)
    }

    fn edit_record(&mut self, record: Edit, before: Spot) -> Result<bool, Refusal> {
        let old_illegal = self.game.illegal_nodes().to_vec();
        let change = self.game.edit(&record)?;
        let kept = before.tryout.is_none() || matches!(record, Edit::KeepTryout { .. });
        match record {
            Edit::Play { .. } | Edit::InsertMove { .. } | Edit::Flatten { .. } => {
                self.current = change.focus;
                self.tip = change.focus;
            }
            Edit::SetupStone { .. } | Edit::MoveStone { .. } | Edit::SetToPlay { .. }
                if change.focus != before.current =>
            {
                self.current = change.focus;
                self.tip = change.focus;
            }
            Edit::Delete { .. } => self.retip_after_detach(),
            Edit::DropTryout => {
                self.retip_after_detach();
                self.current = self.tryout.take().expect("active try-out");
                if !self.selected_line.contains(&self.current) {
                    self.tip = self.current;
                }
            }
            Edit::KeepTryout { .. } if !self.has_tryout_nodes() => self.tryout = None,
            Edit::Promote { .. } | Edit::MoveUp { .. } => {
                // Reordering can move the cursor off the first-child extension of the tip.
                if !self.game.line_through(self.tip).contains(&before.current) {
                    self.tip = before.current;
                }
            }
            _ => {}
        }
        let has_entry = !change.forward.is_empty() || before.tryout != self.tryout;
        self.tree_revision += u64::from(edited_tree(&change, &old_illegal, &self.game));
        let kind = EntryKind::Record(change);
        self.refresh_line(edited_trend_nodes(&kind, &self.selected_line));
        if has_entry {
            self.push(kind, kept, before);
        } else if self.spot() == before {
            return Ok(false);
        }
        self.revision += 1;
        self.trim();
        Ok(true)
    }

    fn play_edit(&self, mv: Move) -> Edit {
        Edit::Play {
            at: self.current,
            color: self.game.to_play(self.current),
            mv,
            tryout: self.tryout.is_some(),
        }
    }

    pub fn undo(&mut self) -> bool {
        let Some(entry) = self.history.undo() else {
            return false;
        };
        let positions_changed = edited_trend_nodes(&entry.kind, &self.selected_line);
        match &entry.kind {
            EntryKind::Record(change) => {
                let old_illegal = self.game.illegal_nodes().to_vec();
                self.game.undo(change);
                self.tree_revision += u64::from(edited_tree(change, &old_illegal, &self.game));
            }
            EntryKind::Rules { before, .. } => self.rules = *before,
        }
        let spot = entry.before;
        self.restore(spot, positions_changed);
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(entry) = self.history.redo() else {
            return false;
        };
        let positions_changed = edited_trend_nodes(&entry.kind, &self.selected_line);
        match &entry.kind {
            EntryKind::Record(change) => {
                let old_illegal = self.game.illegal_nodes().to_vec();
                self.game.redo(change);
                self.tree_revision += u64::from(edited_tree(change, &old_illegal, &self.game));
            }
            EntryKind::Rules { after, .. } => self.rules = *after,
        }
        let spot = entry.after;
        self.restore(spot, positions_changed);
        true
    }

    pub fn changed(&self) -> bool {
        self.history.changed()
    }

    pub fn last_kept(&self) -> u64 {
        self.history.last_kept()
    }

    pub fn mark_saved(&mut self, id: u64, utf8: bool) -> bool {
        let changed = self.changed();
        self.history.mark_saved(id);
        let updated = changed != self.changed() || self.source.needs_save_as;
        self.source.needs_save_as = false;
        if utf8 {
            self.source = Source::utf8();
            for other in &mut self.others {
                declare_utf8(other);
            }
        }
        self.revision += u64::from(updated);
        updated
    }

    /// The board after `moves` from the current node; nothing changes.
    pub fn preview(&self, moves: &[Move]) -> Preview {
        self.game.preview(self.current, moves)
    }

    /// The filename and UTF-8 text for a full Save As without added analysis.
    pub fn export(&self) -> Option<(String, String)> {
        let (name, data) = self.export_with(ExportOptions::default(), &HashMap::new())?;
        Some((
            name,
            String::from_utf8(data.bytes).expect("Save As always encodes UTF-8"),
        ))
    }

    /// Exports the kept record or the selected line. Unopened games accompany a full export.
    pub fn export_with(
        &self,
        options: ExportOptions,
        lz: &HashMap<NodeId, String>,
    ) -> Option<(String, Encoded)> {
        let changed = !self.rules.same_effect(&self.from_file);
        let branch = options.scope == ExportScope::Branch;
        let mut stale = HashSet::new();
        if self.last_kept() != 0 && !options.clean && !self.source_lz.is_empty() {
            let scope = self.export_scope(options.scope);
            self.game
                .visit_positions(&self.rules, scope, |id, _, _, position| {
                    let source = if id == self.game.root() {
                        self.source_root
                    } else {
                        id
                    };
                    if let Some(original) = self.source_lz.get(&source)
                        && !lz.contains_key(&id)
                        && position.map(Position::key) != *original
                    {
                        stale.insert(id);
                    }
                });
        }
        let tree = self.game.to_sgf_with(
            changed.then_some(&self.rules),
            branch.then_some(&self.selected_line[..]),
            |id, node| {
                let prop = if id == self.game.root() { "LZOP" } else { "LZ" };
                if options.clean {
                    clean_node(node);
                } else if let Some(text) = lz.get(&id) {
                    node.props.retain(|p| p.id != prop);
                    node.push(prop, [text.clone()]);
                } else if stale.contains(&id) {
                    node.props.retain(|p| p.id != prop);
                }
            },
        );
        // Determine emptiness from the original record: a clean copy can legitimately
        // omit the comment that made a header-only record worth saving.
        let bare_root = tree.nodes.len() == 1
            && tree.variations.is_empty()
            && self
                .game
                .sgf(self.game.root())
                .props
                .iter()
                .all(|p| matches!(p.id.as_str(), "CA" | "FF" | "GM" | "SZ"));
        if !changed && bare_root && (branch || self.others.is_empty()) && lz.is_empty() {
            return None;
        }
        let mut games = vec![tree];
        if !branch {
            games.extend(self.others.iter().cloned().map(|mut other| {
                if !options.in_place {
                    declare_utf8(&mut other);
                }
                if options.clean {
                    let mut stack = vec![&mut other];
                    while let Some(tree) = stack.pop() {
                        for node in &mut tree.nodes {
                            clean_node(node);
                        }
                        stack.extend(&mut tree.variations);
                    }
                }
                other
            }));
        }
        let (encoding, ca) = if options.in_place {
            (self.source.encoding, self.source.ca.as_deref())
        } else {
            ("UTF-8", Some("UTF-8"))
        };
        let name = format!("{}.sgf", self.name.as_deref().unwrap_or("game"));
        Some((name, encode_sgf(&games, encoding, ca)))
    }

    /// Trend metadata for the selected line, including a visible try-out.
    pub fn line(&self) -> Vec<LineNode<()>> {
        self.line_nodes(PositionScope::Line(&self.selected_line), |_| ())
    }

    /// The immutable positions to search, in kept depth-first order.
    pub fn tree_line_nodes(&self) -> Vec<LineNode> {
        self.line_nodes(PositionScope::Kept, |p| p.cloned())
    }

    pub fn job_nodes(&self, scope: JobScope) -> Vec<LineNode> {
        match scope {
            JobScope::Line => {
                self.line_nodes(PositionScope::Line(self.kept_line()), |p| p.cloned())
            }
            JobScope::AllBranches => self.tree_line_nodes(),
        }
    }

    pub fn export_scope(&self, scope: ExportScope) -> PositionScope<'_> {
        match scope {
            ExportScope::Branch => PositionScope::Line(self.kept_line()),
            ExportScope::Game => PositionScope::Kept,
        }
    }

    fn kept_line(&self) -> &[NodeId] {
        let end = self
            .selected_line
            .iter()
            .position(|&id| self.game.is_tryout(id))
            .unwrap_or(self.selected_line.len());
        &self.selected_line[..end]
    }

    fn line_nodes<P>(
        &self,
        scope: PositionScope<'_>,
        project: impl Fn(Option<&Position>) -> P,
    ) -> Vec<LineNode<P>> {
        let mut nodes = Vec::new();
        let mut slots = HashMap::new();
        self.game
            .visit_positions(&self.rules, scope, |node, move_number, played, position| {
                let parent = self.game.parent(node).map(|id| slots[&id]);
                slots.insert(node, nodes.len());
                nodes.push(LineNode {
                    node,
                    parent,
                    move_number,
                    to_play: position.map(Position::to_move),
                    tryout: self.game.is_tryout(node),
                    mover: played.map(|p| p.0),
                    mv: played.map(|p| p.1),
                    key: position.map(Position::key),
                    position: project(position),
                });
            });
        nodes
    }

    #[cfg(test)]
    pub(crate) fn cached_states(&self) -> usize {
        self.game.cached_states()
    }

    /// The next current-line move, skipping nodes without one as long as they leave the board as it
    /// is (comments); a node that changes it (setup stones) ends the search.
    fn next_move(&self) -> Option<(NodeId, Move)> {
        self.game
            .next_move_on_line(self.current, &self.selected_line[self.line_index() + 1..])
    }

    pub fn tree(&self) -> GameTree {
        let mut nodes = Vec::new();
        let mut stack = vec![self.game.root()];
        while let Some(id) = stack.pop() {
            let played = self.game.recorded_move(id).ok().flatten();
            let mut flags = 0;
            if self.game.comment(id).is_some_and(|text| !text.is_empty()) {
                flags |= TreeNode::COMMENT;
            }
            if self.game.is_tryout(id) {
                flags |= TreeNode::TRYOUT;
            }
            if played.is_none() {
                flags |= TreeNode::NO_MOVE;
            }
            if self.game.illegal_nodes().binary_search(&id).is_ok() {
                flags |= TreeNode::ILLEGAL;
            }
            nodes.push(TreeNode {
                id: id as u32,
                parent: self.game.parent(id).map(|p| p as u32),
                color: played.map(|(color, _)| color),
                mv: played.map(|(_, mv)| mv),
                flags,
            });
            stack.extend(self.game.children(id).iter().rev().copied());
        }
        GameTree {
            revision: self.tree_revision,
            nodes,
        }
    }

    pub fn snapshot(&self) -> GameSnapshot {
        let node = self.current;
        let board = self.game.board_at(node);
        let (black, white) = board.captures();
        let index = self.line_index();
        GameSnapshot {
            revision: self.revision,
            game_revision: self.game_revision,
            node: node as u32,
            line_revision: self.line_revision,
            tree_revision: self.tree_revision,
            comment: self.game.comment(node).map(str::to_owned),
            marks: self
                .game
                .marks(node)
                .into_iter()
                .map(|(point, mark)| MarkAt { point, mark })
                .collect(),
            continuations: self
                .game
                .children(node)
                .iter()
                .map(|&id| Continuation {
                    node: id as u32,
                    mv: self.game.last_move(id),
                    tryout: self.game.is_tryout(id),
                })
                .collect(),
            tryout: self.tryout.map(|id| id as u32),
            changed: self.changed(),
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
            save_as_first: self.source.needs_save_as,
            placed: self
                .game
                .placed_by(node)
                .into_iter()
                .map(|p| Placed {
                    point: p.point,
                    node: p.node as u32,
                    number: p.number,
                    branch_number: p.branch_number,
                })
                .collect(),
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
            line_length: self
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

    fn comment(text: &str) -> SessionEdit {
        SessionEdit::SetComment {
            node: 0,
            text: Some(text.into()),
        }
    }

    #[test]
    fn tree_flags_follow_edits_and_their_inverses() {
        let mut s = GameSession::open("flags.sgf", b"(;SZ[9]AB[aa];W[aa])", AnalysisRules::Chinese)
            .unwrap();
        assert_eq!(s.tree().nodes[1].flags, TreeNode::ILLEGAL);
        s.edit(SessionEdit::SetupStone {
            point: Point { x: 0, y: 0 },
            stone: None,
        })
        .unwrap();
        assert_eq!(s.tree_revision, 1);
        assert_eq!(s.tree().nodes[1].flags, 0);
        s.undo();
        assert_eq!(s.tree_revision, 2);
        assert_eq!(s.tree().nodes[1].flags, TreeNode::ILLEGAL);
        s.redo();
        s.edit(SessionEdit::TryoutStart).unwrap();
        s.edit(SessionEdit::Play { mv: play(1, 1) }).unwrap();
        let scratch = s.snapshot().node;
        assert_eq!(s.tree().nodes.last().unwrap().flags, TreeNode::TRYOUT);
        s.edit(SessionEdit::TryoutKeep { node: scratch }).unwrap();
        assert_eq!(s.tree().nodes.last().unwrap().flags, 0);
    }

    #[test]
    fn tree_preorder_follows_reordered_siblings() {
        let mut s = branches();
        s.edit(SessionEdit::Promote { node: 4 }).unwrap();
        assert_eq!(
            s.tree().nodes.iter().map(|n| n.id).collect::<Vec<_>>(),
            [0, 1, 4, 5, 6, 2, 3]
        );
        s.undo();
        assert_eq!(
            s.tree().nodes.iter().map(|n| n.id).collect::<Vec<_>>(),
            [0, 1, 2, 3, 4, 5, 6]
        );
    }

    #[test]
    fn changed_follows_the_last_kept_edit() {
        let mut s = branches();
        assert_eq!(s.last_kept(), 0);
        s.edit(comment("one")).unwrap();
        assert!(s.changed());
        assert!(s.undo());
        assert_eq!(s.last_kept(), 0);
        assert!(!s.changed());
        assert!(s.redo());
        assert_eq!(s.game.comment(0), Some("one"));
        assert!(s.changed());
    }

    #[test]
    fn undo_to_the_saved_edit_clears_changed() {
        let mut s = branches();
        s.edit(comment("one")).unwrap();
        let saved = s.last_kept();
        s.mark_saved(saved, false);
        s.edit(comment("two")).unwrap();
        assert!(s.changed());
        assert!(s.undo());
        assert_eq!(s.last_kept(), saved);
        assert!(!s.changed());
    }

    #[test]
    fn a_dropped_redo_past_the_save_stays_changed() {
        let mut s = branches();
        s.edit(comment("one")).unwrap();
        s.mark_saved(s.last_kept(), false);
        s.undo();
        s.edit(comment("two")).unwrap();
        assert!(s.changed());
        assert!(!s.redo());
        s.undo();
        assert!(s.changed());
    }

    #[test]
    fn tryout_entries_never_change_changed() {
        let mut s = branches();
        s.edit(SessionEdit::TryoutStart).unwrap();
        s.edit(SessionEdit::Play { mv: play(1, 1) }).unwrap();
        let scratch = s.current as u32;
        s.edit(SessionEdit::SetComment {
            node: scratch,
            text: Some("scratch".into()),
        })
        .unwrap();
        s.edit(SessionEdit::DeleteFrom { node: scratch }).unwrap();
        s.edit(SessionEdit::TryoutEnd).unwrap();
        assert!(!s.changed());
        while s.undo() {
            assert!(!s.changed());
        }
    }

    #[test]
    fn keep_tryout_is_a_kept_edit() {
        let mut s = branches();
        s.edit(SessionEdit::TryoutStart).unwrap();
        s.edit(SessionEdit::Play { mv: play(1, 1) }).unwrap();
        let first = s.current;
        s.navigate(NavTarget::First);
        s.edit(SessionEdit::Play { mv: play(2, 2) }).unwrap();
        let second = s.current;
        s.edit(SessionEdit::TryoutKeep {
            node: second as u32,
        })
        .unwrap();
        assert!(s.changed());
        assert!(s.game.is_tryout(first));
        assert!(!s.game.is_tryout(second));
        assert_eq!(s.tryout, Some(0));
        s.edit(SessionEdit::TryoutKeep { node: first as u32 })
            .unwrap();
        assert_eq!(s.tryout, None);
        s.undo();
        assert_eq!(s.tryout, Some(0));
        assert!(s.game.is_tryout(first));
        s.undo();
        assert!(!s.changed());
        assert!(s.game.is_tryout(second));
    }

    #[test]
    fn both_pass_commands_make_undoable_scratch_moves() {
        for pass in [SessionEdit::Pass, SessionEdit::Play { mv: Move::Pass }] {
            let mut s = branches();
            s.edit(SessionEdit::TryoutStart).unwrap();
            s.edit(pass).unwrap();
            let scratch = s.current;
            assert!(s.game.is_tryout(scratch));
            assert_eq!(s.game.last_move(scratch), Some(Move::Pass));
            assert!(!s.changed());
            assert!(s.undo());
            assert_eq!(s.current, 0);
            assert!(!s.game.is_attached(scratch));
            assert!(s.redo());
            assert_eq!(s.current, scratch);
            assert!(!s.changed());
        }
    }

    #[test]
    fn changing_to_play_rebases_live_and_job_positions_and_undo_restores_the_key() {
        let mut s = branches();
        s.edit(SessionEdit::Play { mv: play(2, 2) }).unwrap();
        let previous = s.position().unwrap();
        assert_eq!(previous.to_move(), Color::White);
        for color in [Color::Black, Color::White] {
            s.edit(SessionEdit::SetToPlay { color }).unwrap();
            let live = s.position().unwrap();
            assert_eq!(live.to_move(), color);
            assert_eq!(live.key() == previous.key(), color == Color::White);
            for scope in [JobScope::Line, JobScope::AllBranches] {
                let entries = s.job_nodes(scope);
                let entry = entries.iter().find(|n| n.node == s.current).unwrap();
                assert_eq!(entry.position.as_ref(), Some(&live));
            }
            assert!(s.undo());
            assert_eq!(s.position(), Some(previous.clone()));
        }
    }

    #[test]
    fn kept_edits_are_refused_during_tryout() {
        let mut s = branches();
        s.edit(SessionEdit::TryoutStart).unwrap();
        for edit in [
            comment("x"),
            SessionEdit::DeleteFrom { node: 1 },
            SessionEdit::Promote { node: 4 },
            SessionEdit::SetRules { rules: None },
            SessionEdit::TryoutStart,
        ] {
            assert_eq!(s.edit(edit), Err(Refusal::EndTryoutFirst));
        }
        assert_eq!(
            s.edit(SessionEdit::SetComment {
                node: u32::MAX,
                text: None
            }),
            Err(Refusal::NoSuchNode)
        );
        assert!(!s.changed());
        assert!(s.undo());
        assert!(!s.undo());
    }

    #[test]
    fn undo_of_tryout_end_restores_the_tryout() {
        let mut s = branches();
        s.navigate(NavTarget::Node(6));
        s.edit(SessionEdit::TryoutStart).unwrap();
        s.navigate(NavTarget::First);
        s.edit(SessionEdit::Play { mv: play(1, 1) }).unwrap();
        let scratch = s.current;
        s.edit(SessionEdit::TryoutEnd).unwrap();
        assert_eq!((s.current, s.tryout), (6, None));
        assert!(!s.game.is_attached(scratch));
        s.undo();
        assert_eq!((s.current, s.tip, s.tryout), (scratch, scratch, Some(6)));
        assert!(s.game.is_tryout(scratch));
        s.redo();
        assert_eq!((s.current, s.tryout), (6, None));
    }

    #[test]
    fn undo_lands_on_the_node_before_the_edit() {
        let mut s = branches();
        s.navigate(NavTarget::Node(6));
        s.edit(SessionEdit::DeleteFrom { node: 4 }).unwrap();
        assert_eq!((s.current, s.tip), (1, 1));
        s.navigate(NavTarget::First);
        s.undo();
        assert_eq!((s.current, s.tip), (6, 6));
        s.redo();
        assert_eq!((s.current, s.tip), (1, 1));
    }

    #[test]
    fn delete_branch_removes_from_the_variation_start() {
        let mut s = branches();
        assert_eq!(
            s.edit(SessionEdit::DeleteBranch { node: 3 }),
            Err(Refusal::NoSuchNode)
        );
        s.edit(SessionEdit::DeleteBranch { node: 5 }).unwrap();
        assert_eq!(s.game.children(1), [2]);
        assert!(!s.game.is_attached(6));
        s.undo();
        assert_eq!(s.game.children(1), [2, 4]);
    }

    #[test]
    fn rules_edits_undo() {
        let mut s = branches();
        s.navigate(NavTarget::Node(6));
        s.edit(SessionEdit::SetRules {
            rules: Some(AnalysisRules::JapaneseKorean),
        })
        .unwrap();
        assert!(s.changed());
        s.navigate(NavTarget::First);
        s.undo();
        assert_eq!(s.rules(), AnalysisRules::Chinese);
        assert_eq!(s.current, 6);
        s.redo();
        assert_eq!(s.rules(), AnalysisRules::JapaneseKorean);
    }

    #[test]
    fn entering_an_existing_move_is_not_a_change() {
        let mut s = branches();
        s.edit(SessionEdit::Play { mv: play(0, 0) }).unwrap();
        assert_eq!((s.current, s.tip), (1, 1));
        assert!(!s.changed());
        assert!(!s.undo());
    }

    #[test]
    fn an_unchanged_comment_or_rules_value_is_not_an_edit() {
        let mut s = branches();
        s.edit(comment("one")).unwrap();
        s.mark_saved(s.last_kept(), false);
        assert_eq!(s.edit(comment("one")), Ok(false));
        let equivalent = AnalysisRules::Custom {
            komi: s.rules().komi(),
            scoring: s.rules().scoring(),
            details: None,
        };
        s.edit(SessionEdit::SetRules {
            rules: Some(equivalent),
        })
        .unwrap();
        assert_eq!(s.rules(), equivalent);
        assert!(!s.changed());
        s.undo();
        assert_eq!(s.game.comment(0), None);
    }

    #[test]
    fn undo_walks_back_through_the_tryout_start() {
        let mut s = branches();
        s.edit(comment("one")).unwrap();
        s.edit(SessionEdit::TryoutStart).unwrap();
        s.edit(SessionEdit::Play { mv: play(2, 3) }).unwrap();
        s.undo();
        assert_eq!((s.tryout, s.current), (Some(0), 0));
        s.undo();
        assert_eq!(s.tryout, None);
        assert!(s.changed());
        s.undo();
        assert!(!s.changed());
        s.redo();
        s.redo();
        assert_eq!(s.tryout, Some(0));
    }

    #[test]
    fn discarded_redo_releases_detached_move_contents() {
        let mut s = branches();
        s.edit(SessionEdit::Play { mv: play(1, 1) }).unwrap();
        let id = s.current;
        s.undo();
        assert!(s.game.sgf(id).first("B").is_some());
        s.edit(comment("replaces redo")).unwrap();
        assert!(s.game.sgf(id).props.is_empty());
    }

    #[test]
    fn an_evicted_move_stays_available_to_a_retained_deletion() {
        let mut s = branches();
        s.edit(SessionEdit::Play { mv: play(1, 1) }).unwrap();
        let id = s.current;
        s.edit(SessionEdit::DeleteFrom { node: id as u32 }).unwrap();
        for i in 0..999 {
            s.edit(comment(&i.to_string())).unwrap();
        }
        for _ in 0..1000 {
            assert!(s.undo());
        }
        assert_eq!(s.game.last_move(id), Some(play(1, 1)));
        assert!(s.game.is_attached(id));
        assert!(s.changed());
    }

    #[test]
    fn invalid_rules_are_rejected_without_replacing_history() {
        let mut s = branches();
        s.edit(comment("one")).unwrap();
        s.undo();
        let rules = AnalysisRules::Custom {
            komi: aji_core::Komi::new(151.0).unwrap(),
            scoring: s.rules().scoring(),
            details: None,
        };
        assert_eq!(
            s.edit(SessionEdit::SetRules { rules: Some(rules) }),
            Err(Refusal::InvalidRules)
        );
        assert_eq!(s.rules(), AnalysisRules::Chinese);
        assert!(s.redo());
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
    fn moving_the_last_move_asks_before_making_later_moves_illegal() {
        let mut s = GameSession::open(
            "move.sgf",
            b"(;SZ[9];B[aa];W[bb];B[cc];W[dd])",
            AnalysisRules::Chinese,
        )
        .unwrap();
        s.navigate(NavTarget::Node(1));
        let to = |x, y, allow_illegal| SessionEdit::MoveLastMove {
            to: Point { x, y },
            allow_illegal,
        };
        // B[cc] at node 3 would land on the moved stone.
        assert_eq!(s.edit(to(2, 2, false)), Err(Refusal::LaterMovesIllegal(1)));
        assert_eq!(s.game.sgf(1).first("B"), Some("aa"));
        let tree = s.tree_revision;
        assert_eq!(s.edit(to(4, 4, false)), Ok(true));
        assert_eq!(s.game.sgf(1).first("B"), Some("ee"));
        assert_eq!(s.current, 1);
        assert!(s.tree_revision > tree, "the tree shows each node's move");
        assert!(s.undo());
        assert_eq!(s.game.sgf(1).first("B"), Some("aa"));
        assert_eq!(s.edit(to(2, 2, true)), Ok(true));
        assert_eq!(s.game.illegal_nodes(), [3]);
        assert_eq!(
            s.edit(to(9, 0, true)),
            Err(Refusal::Illegal(Illegal::OffBoard))
        );
    }

    #[test]
    fn during_try_out_only_a_try_out_move_moves() {
        let mut s = GameSession::open("t.sgf", b"(;SZ[9];B[aa])", AnalysisRules::Chinese).unwrap();
        s.navigate(NavTarget::Node(1));
        assert_eq!(s.edit(SessionEdit::TryoutStart), Ok(true));
        let edit = SessionEdit::MoveLastMove {
            to: Point { x: 4, y: 4 },
            allow_illegal: false,
        };
        assert_eq!(s.edit(edit.clone()), Err(Refusal::EndTryoutFirst));
        assert_eq!(
            s.edit(SessionEdit::Play {
                mv: Move::Play(Point { x: 2, y: 2 })
            }),
            Ok(true)
        );
        assert_eq!(s.edit(edit), Ok(true));
        assert_eq!(s.game.sgf(s.current).first("W"), Some("ee"));
    }

    #[test]
    fn edits_to_selected_positions_invalidate_the_line_in_both_directions() {
        let mut s =
            GameSession::open("line.sgf", b"(;SZ[9];B[aa])", AnalysisRules::Chinese).unwrap();
        let point = Point { x: 1, y: 1 };
        let other = Point { x: 2, y: 2 };
        for edit in [
            SessionEdit::SetupStone {
                point,
                stone: Some(Color::White),
            },
            SessionEdit::MoveStone {
                from: point,
                to: other,
            },
            SessionEdit::SetToPlay {
                color: Color::White,
            },
            SessionEdit::SetRules {
                rules: Some(AnalysisRules::JapaneseKorean),
            },
        ] {
            let keys = |s: &GameSession| {
                s.line()
                    .into_iter()
                    .map(|node| node.key)
                    .collect::<Vec<_>>()
            };
            let before = keys(&s);
            let revision = s.line_revision;
            assert_eq!(s.edit(edit), Ok(true));
            let after = keys(&s);
            assert_ne!(before, after);
            assert_eq!(s.current_line(), [0, 1]);
            assert_eq!(s.line_revision, revision + 1);
            assert!(s.undo());
            assert_eq!(keys(&s), before);
            assert_eq!(s.line_revision, revision + 2);
            assert!(s.redo());
            assert_eq!(keys(&s), after);
            assert_eq!(s.line_revision, revision + 3);
        }
    }

    #[test]
    fn metadata_and_off_line_edits_preserve_the_line_revision() {
        let mut s = branches();
        let revision = s.line_revision;
        for edit in [
            comment("still the same position"),
            SessionEdit::SetMark {
                node: 0,
                point: Point { x: 1, y: 1 },
                mark: Some(Mark::Triangle),
            },
            SessionEdit::SetInfo {
                field: InfoField::Black,
                value: Some("Black".into()),
            },
            SessionEdit::DeleteFrom { node: 4 },
        ] {
            assert_eq!(s.edit(edit), Ok(true));
            assert_eq!(s.line_revision, revision);
            assert!(s.undo());
            assert_eq!(s.line_revision, revision);
            assert!(s.redo());
            assert_eq!(s.line_revision, revision);
        }
        let equivalent = AnalysisRules::Custom {
            komi: s.rules().komi(),
            scoring: s.rules().scoring(),
            details: None,
        };
        assert_eq!(
            s.edit(SessionEdit::SetRules {
                rules: Some(equivalent)
            }),
            Ok(true)
        );
        assert_eq!(s.line_revision, revision);
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
        assert_eq!(session.snapshot().game_revision, 8);
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
        assert_eq!(
            session.edit(SessionEdit::SetRules { rules: Some(rules) }),
            Ok(true)
        );
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
