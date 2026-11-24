//! A game built from an SGF tree: nodes in an arena, boards per node, the main line, and the
//! positions KataGo analyses.

use std::borrow::Cow;
use std::collections::HashSet;
use std::sync::OnceLock;

use serde::Serialize;
use ts_rs::TS;

use super::board::{Board, Illegal, expand_points};
use super::edit::Op;
use super::rules::{AnalysisRules, RulesReading, is_fox_even_game, read_rules};
use crate::coords::{BoardSize, Color, Move, Point};
use crate::position::Position;
use crate::sgf::{SgfNode, SgfProp, SgfTree};

/// A node's index in the game's arena. Ids stay stable when nodes move.
pub type NodeId = usize;

/// The record's information from the root, for display.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GameInfo {
    pub black: Option<String>,
    pub white: Option<String>,
    pub black_rank: Option<String>,
    pub white_rank: Option<String>,
    pub result: Option<String>,
    pub date: Option<String>,
    pub event: Option<String>,
    pub round: Option<String>,
    pub game_name: Option<String>,
    pub place: Option<String>,
    pub handicap: Option<u8>,
}

/// Why a tree cannot be opened as a game.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameError {
    /// `GM` names a game other than Go.
    NotGo,
    /// Not a square board of 5 to 19 lines. Sizes saturate at 255; an unreadable `SZ` is 0.
    UnsupportedSize { width: u8, height: u8 },
}

/// A board after a sequence of preview moves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Preview {
    pub stones: Vec<Option<Color>>,
    /// The points each move captured.
    pub captured: Vec<Vec<Point>>,
    /// The index of the first illegal move.
    pub illegal_at: Option<u32>,
}

struct Node {
    sgf: SgfNode,
    parent: Option<NodeId>,
    children: Vec<NodeId>,
    tryout: bool,
    attached: bool,
}

/// What follows from playing the path to a node; computed when first asked for.
#[derive(Clone)]
struct NodeState {
    board: Board,
    mv: Option<(Color, Move)>,
    illegal: Option<Illegal>,
    move_number: u32,
    to_play: Color,
    /// The latest node on the path that a move list cannot express (setup stones or an
    /// illegal move), else the root.
    base: NodeId,
}

/// A game: the SGF nodes in an arena, with boards and positions derived along any path.
pub struct Game {
    size: BoardSize,
    root: NodeId,
    illegal_nodes: Vec<NodeId>,
    nodes: Vec<Node>,
    states: Vec<OnceLock<NodeState>>,
    main_line: Vec<NodeId>,
}

impl std::fmt::Debug for Game {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Game")
            .field("size", &self.size)
            .field("nodes", &self.nodes.len())
            .finish()
    }
}

fn board_size(root: &SgfNode) -> Result<BoardSize, GameError> {
    let unsupported = |w: u32, h: u32| GameError::UnsupportedSize {
        width: u8::try_from(w).unwrap_or(u8::MAX),
        height: u8::try_from(h).unwrap_or(u8::MAX),
    };
    let Some(sz) = root.first("SZ") else {
        return Ok(BoardSize::NINETEEN);
    };
    let parse = |s: &str| s.trim().parse::<u32>().ok();
    let (w, h) = match sz.split_once(':') {
        Some((w, h)) => (parse(w), parse(h)),
        None => (parse(sz), parse(sz)),
    };
    let (Some(w), Some(h)) = (w, h) else {
        return Err(unsupported(0, 0));
    };
    if w != h || !(5..=19).contains(&w) {
        return Err(unsupported(w, h));
    }
    BoardSize::new(u8::try_from(w).expect("at most 19")).map_err(|_| unsupported(w, h))
}

fn text(root: &SgfNode, id: &str) -> Option<String> {
    info_value(root.first(id)).map(str::to_owned)
}

pub(super) fn info_value(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|v| !v.is_empty())
}

fn color_of(s: &str) -> Option<Color> {
    match s.trim() {
        "B" | "b" => Some(Color::Black),
        "W" | "w" => Some(Color::White),
        _ => None,
    }
}

fn has_setup(node: &SgfNode) -> bool {
    ["AB", "AW", "AE"].iter().any(|id| node.get(id).is_some())
}

impl Game {
    /// Builds a game from the first tree of a file. `default_rules` applies when the file names
    /// neither rules nor a usable komi.
    pub fn from_sgf(
        tree: SgfTree,
        default_rules: AnalysisRules,
    ) -> Result<(Game, RulesReading), GameError> {
        let empty = SgfNode::default();
        let root_sgf = tree.nodes.first().unwrap_or(&empty);
        if root_sgf.first("GM").is_some_and(|gm| gm.trim() != "1") {
            return Err(GameError::NotGo);
        }
        let size = board_size(root_sgf)?;
        let reading = read_rules(root_sgf, default_rules);
        // Flatten into an arena in pre-order, with an explicit stack.
        let mut nodes: Vec<Node> = Vec::new();
        let mut stack: Vec<(SgfTree, Option<NodeId>)> = vec![(tree, None)];
        while let Some((tree, parent)) = stack.pop() {
            let mut parent = parent;
            for sgf in tree.nodes {
                let id = nodes.len();
                nodes.push(Node {
                    sgf,
                    parent,
                    children: Vec::new(),
                    attached: true,
                    tryout: false,
                });
                if let Some(p) = parent {
                    nodes[p].children.push(id);
                }
                parent = Some(id);
            }
            // Pushed in reverse so the first variation is numbered first.
            for variation in tree.variations.into_iter().rev() {
                stack.push((variation, parent));
            }
        }
        if nodes.is_empty() {
            nodes.push(Node {
                sgf: SgfNode::default(),
                parent: None,
                children: Vec::new(),
                attached: true,
                tryout: false,
            });
        }
        let states = (0..nodes.len()).map(|_| OnceLock::new()).collect();
        let mut game = Game {
            size,
            root: 0,
            nodes,
            states,
            main_line: Vec::new(),
            illegal_nodes: Vec::new(),
        };
        game.main_line = game.line_through(game.root);
        game.illegal_nodes = game.scan_illegal(game.root);
        Ok((game, reading))
    }

    /// Allocates a parentless node. Arena ids are never reused.
    pub fn alloc(&mut self, props: Vec<SgfProp>, tryout: bool) -> NodeId {
        let id = self.nodes.len();
        self.nodes.push(Node {
            sgf: SgfNode { props },
            parent: None,
            children: Vec::new(),
            tryout,
            attached: false,
        });
        self.states.push(OnceLock::new());
        id
    }

    fn mark_subtree(&mut self, node: NodeId, attached: bool) {
        let mut stack = vec![node];
        while let Some(id) = stack.pop() {
            self.nodes[id].attached = attached;
            stack.extend_from_slice(self.children(id));
        }
    }

    /// Applies a well-formed primitive operation and returns its exact inverse.
    pub fn apply_op(&mut self, op: &Op) -> Op {
        use std::mem::replace;
        match *op {
            Op::Attach {
                node,
                parent,
                index,
            } => {
                assert!(self.parent(node).is_none() && !self.is_attached(node));
                // An attached parent belongs to a different tree by construction.
                assert!(
                    self.is_attached(parent)
                        || !std::iter::successors(Some(parent), |&p| self.parent(p))
                            .any(|p| p == node)
                );
                self.nodes[parent].children.insert(index, node);
                self.nodes[node].parent = Some(parent);
                self.mark_subtree(node, self.is_attached(parent));
                self.invalidate(node);
                Op::Detach { node }
            }
            Op::Detach { node } => {
                let parent = self.parent(node).expect("detaching a node with a parent");
                let index = self
                    .children(parent)
                    .iter()
                    .position(|&id| id == node)
                    .expect("parent lists the child");
                self.nodes[parent].children.remove(index);
                self.nodes[node].parent = None;
                self.mark_subtree(node, false);
                self.invalidate(node);
                Op::Attach {
                    node,
                    parent,
                    index,
                }
            }
            Op::SetProps { node, ref props } => {
                let props = replace(&mut self.nodes[node].sgf.props, props.clone());
                self.invalidate(node);
                Op::SetProps { node, props }
            }
            Op::SetTryout { node, on } => {
                let on = replace(&mut self.nodes[node].tryout, on);
                Op::SetTryout { node, on }
            }
            Op::SetRoot { node } => {
                assert!(self.parent(node).is_none());
                let old = replace(&mut self.root, node);
                if old != node {
                    self.mark_subtree(old, false);
                    self.invalidate(old);
                    self.mark_subtree(node, true);
                    self.invalidate(node);
                }
                Op::SetRoot { node: old }
            }
            Op::Reorder {
                parent,
                ref children,
            } => {
                let mut expected = self.children(parent).to_vec();
                let mut actual = children.clone();
                expected.sort_unstable();
                actual.sort_unstable();
                assert_eq!(expected, actual, "reorder must preserve the children");
                let children = replace(&mut self.nodes[parent].children, children.clone());
                self.main_line = self.line_through(self.root);
                Op::Reorder { parent, children }
            }
        }
    }

    /// Drops the contents of detached trees that the caller's history can no longer reach.
    pub fn release(&mut self, nodes: &[NodeId]) {
        let mut stack = Vec::new();
        for &id in nodes {
            if !self.is_attached(id) && self.parent(id).is_none() {
                stack.push(id);
            }
        }
        while let Some(id) = stack.pop() {
            let node = &mut self.nodes[id];
            stack.append(&mut std::mem::take(&mut node.children));
            node.sgf = SgfNode::default();
            node.parent = None;
            node.tryout = false;
            self.states[id].take();
        }
    }

    pub fn size(&self) -> BoardSize {
        self.size
    }

    pub fn info(&self) -> GameInfo {
        let root_sgf = self.sgf(self.root);
        GameInfo {
            black: text(root_sgf, "PB"),
            white: text(root_sgf, "PW"),
            black_rank: text(root_sgf, "BR"),
            white_rank: text(root_sgf, "WR"),
            result: text(root_sgf, "RE"),
            date: text(root_sgf, "DT"),
            event: text(root_sgf, "EV"),
            round: text(root_sgf, "RO"),
            game_name: text(root_sgf, "GN"),
            place: text(root_sgf, "PC"),
            handicap: root_sgf.first("HA").and_then(|h| h.trim().parse().ok()),
        }
    }

    pub fn root(&self) -> NodeId {
        self.root
    }

    pub fn children(&self, node: NodeId) -> &[NodeId] {
        &self.nodes[node].children
    }

    pub fn is_tryout(&self, node: NodeId) -> bool {
        self.nodes[node].tryout
    }

    pub fn is_attached(&self, node: NodeId) -> bool {
        self.nodes.get(node).is_some_and(|n| n.attached)
    }

    pub fn path_to(&self, node: NodeId) -> Vec<NodeId> {
        let mut path: Vec<_> = std::iter::successors(Some(node), |&id| self.parent(id)).collect();
        path.reverse();
        path
    }

    pub fn line_through(&self, tip: NodeId) -> Vec<NodeId> {
        let mut line = self.path_to(tip);
        let mut at = tip;
        while let Some(&child) = self.children(at).iter().find(|&&id| self.is_attached(id)) {
            line.push(child);
            at = child;
        }
        line
    }

    /// The node's properties as the file had them.
    pub fn sgf(&self, node: NodeId) -> &SgfNode {
        &self.nodes[node].sgf
    }

    pub fn main_line(&self) -> &[NodeId] {
        &self.main_line
    }

    pub fn parent(&self, node: NodeId) -> Option<NodeId> {
        self.nodes[node].parent
    }

    /// Whether the record holds no move and no setup stone.
    pub fn is_empty(&self) -> bool {
        self.nodes
            .iter()
            .filter(|n| n.attached && !n.tryout)
            .all(|n| !has_setup(&n.sgf) && n.sgf.get("B").is_none() && n.sgf.get("W").is_none())
    }

    /// The node followed by each uncached ancestor, nearest first.
    fn replay_path(&self, node: NodeId) -> Vec<NodeId> {
        let ancestors = std::iter::successors(self.parent(node), |&id| self.parent(id))
            .take_while(|&id| self.states[id].get().is_none());
        std::iter::once(node).chain(ancestors).collect()
    }

    fn state(&self, node: NodeId) -> &NodeState {
        if let Some(state) = self.states[node].get() {
            return state;
        }
        let path = self.replay_path(node);
        for &id in path.iter().rev() {
            let parent = self.nodes[id]
                .parent
                .map(|p| self.states[p].get().expect("computed"));
            let state = self.compute(id, parent);
            let _ = self.states[id].set(state);
        }
        self.states[node].get().expect("computed")
    }

    fn apply_setup(&self, sgf: &SgfNode, board: &mut Board) {
        for (prop, stone) in [
            ("AB", Some(Color::Black)),
            ("AW", Some(Color::White)),
            ("AE", None),
        ] {
            for value in sgf
                .get(prop)
                .map(|p| p.values.as_slice())
                .unwrap_or_default()
            {
                for point in expand_points(value.trim(), self.size) {
                    board.set(point, stone);
                }
            }
        }
    }

    fn recorded_move(&self, node: NodeId) -> Result<Option<(Color, Move)>, Illegal> {
        let sgf = self.sgf(node);
        let Some((color, value)) = [("B", Color::Black), ("W", Color::White)]
            .into_iter()
            .find_map(|(id, color)| sgf.first(id).map(|v| (color, v.trim())))
        else {
            return Ok(None);
        };
        let mv = if value.is_empty() || (value == "tt" && self.size.get() <= 19) {
            Move::Pass
        } else {
            match expand_points(value, self.size).as_slice() {
                [p] if !value.contains(':') => Move::Play(*p),
                _ => return Err(Illegal::OffBoard),
            }
        };
        Ok(Some((color, mv)))
    }

    /// Looks ahead for a move without retaining the boards of intervening SGF nodes.
    pub fn next_move_on_line(
        &self,
        current: NodeId,
        following: &[NodeId],
    ) -> Option<(NodeId, Move)> {
        for &id in following {
            if let Some(mv) = self.last_move(id) {
                return Some((id, mv));
            }
            let sgf = self.sgf(id);
            if has_setup(sgf) {
                let here = self.board_at(current);
                let mut after = here.clone();
                self.apply_setup(sgf, &mut after);
                if after.stones() != here.stones() {
                    return None;
                }
            }
        }
        None
    }

    fn compute(&self, id: NodeId, parent: Option<&NodeState>) -> NodeState {
        let sgf = &self.nodes[id].sgf;
        let mut board = parent.map_or_else(|| Board::new(self.size), |p| p.board.clone());
        let setup = has_setup(sgf);
        self.apply_setup(sgf, &mut board);
        let (played, illegal) = match self.recorded_move(id) {
            Ok(Some((color, mv))) => (Some((color, mv)), board.play(color, mv, false).illegal),
            Ok(None) => (None, None),
            Err(illegal) => (None, Some(illegal)),
        };

        let move_number = parent.map_or(0, |p| p.move_number) + u32::from(played.is_some());
        let to_play = if let Some(pl) = sgf.first("PL").and_then(color_of) {
            pl
        } else if let Some((color, _)) = played {
            color.opponent()
        } else if let Some(p) = parent {
            p.to_play
        } else if sgf
            .first("HA")
            .and_then(|h| h.trim().parse::<u8>().ok())
            .is_some_and(|h| h >= 2)
            && sgf.get("AB").is_some()
        {
            Color::White
        } else {
            Color::Black
        };
        let base = if setup || illegal.is_some() {
            id
        } else {
            parent.map_or(id, |p| p.base)
        };
        NodeState {
            board,
            mv: played,
            illegal,
            move_number,
            to_play,
            base,
        }
    }

    /// Moves (passes included) from the root to `node`.
    pub fn move_number(&self, node: NodeId) -> u32 {
        self.state(node).move_number
    }

    pub fn board_at(&self, node: NodeId) -> &Board {
        &self.state(node).board
    }

    /// The node's own move.
    pub fn last_move(&self, node: NodeId) -> Option<Move> {
        self.recorded_move(node).ok().flatten().map(|(_, mv)| mv)
    }

    /// The colour of the node's own move.
    pub fn last_color(&self, node: NodeId) -> Option<Color> {
        self.state(node).mv.map(|(c, _)| c)
    }

    pub fn to_play(&self, node: NodeId) -> Color {
        self.state(node).to_play
    }

    pub fn illegal(&self, node: NodeId) -> Option<Illegal> {
        self.state(node).illegal
    }

    /// Replays the path for a legality scan without retaining the intermediate boards.
    fn replay_uncached(&self, node: NodeId) -> NodeState {
        let mut path = self.replay_path(node);
        let first = path.pop().expect("path includes the node");
        let parent = self.parent(first).and_then(|p| self.states[p].get());
        let mut state = self.compute(first, parent);
        for id in path.into_iter().rev() {
            state = self.compute(id, Some(&state));
        }
        state
    }

    /// Visits a subtree with one saved position per open fork, regardless of its width.
    fn scan_illegal(&self, start: NodeId) -> Vec<NodeId> {
        let mut illegal = Vec::new();
        if !self.is_attached(start) {
            return illegal;
        }
        let mut at = start;
        let mut state = self.replay_uncached(start);
        let mut forks = Vec::new();
        loop {
            if state.illegal.is_some() {
                illegal.push(at);
            }
            let mut children = self
                .children(at)
                .iter()
                .copied()
                .filter(|&c| self.is_attached(c))
                .peekable();
            if let Some(child) = children.next() {
                let next = self.compute(child, Some(&state));
                if children.peek().is_some() {
                    forks.push((children, state));
                }
                at = child;
                state = next;
            } else if let Some((mut siblings, parent)) = forks.pop() {
                at = siblings.next().expect("fork has a remaining child");
                state = self.compute(at, Some(&parent));
                if siblings.peek().is_some() {
                    forks.push((siblings, parent));
                }
            } else {
                break;
            }
        }
        illegal.sort_unstable();
        illegal
    }

    /// Refreshes the illegal flags and main line after changing a subtree.
    pub fn invalidate(&mut self, node: NodeId) {
        let mut changed = HashSet::new();
        let mut stack = vec![node];
        while let Some(id) = stack.pop() {
            self.states[id].take();
            changed.insert(id);
            stack.extend_from_slice(self.children(id));
        }
        self.illegal_nodes.retain(|id| !changed.contains(id));
        let illegal = self.scan_illegal(node);
        self.illegal_nodes.extend(illegal);
        self.illegal_nodes.sort_unstable();
        self.main_line = self.line_through(self.root);
    }

    /// Keeps the current path and at most 4096 other cached positions.
    pub fn trim(&mut self, keep: &[NodeId]) {
        const LIMIT: usize = 4096;
        let keep: HashSet<_> = keep.iter().copied().collect();
        let mut others = 0;
        for (id, state) in self.states.iter_mut().enumerate() {
            if state.get().is_some() && !keep.contains(&id) {
                others += 1;
                if others > LIMIT {
                    state.take();
                }
            }
        }
    }

    pub fn illegal_nodes(&self) -> &[NodeId] {
        &self.illegal_nodes
    }

    pub fn has_illegal(&self) -> bool {
        !self.illegal_nodes.is_empty()
    }

    /// The position KataGo analyses at `node`; `None` on an illegal node. After setup stones or
    /// an illegal move, the position starts from that node's board (design 5.2).
    pub fn position_at(&self, node: NodeId, rules: &AnalysisRules) -> Option<Position> {
        self.position_from_state(node, self.state(node), rules)
    }

    fn transient_state(&self, node: NodeId) -> Cow<'_, NodeState> {
        self.states[node]
            .get()
            .map_or_else(|| Cow::Owned(self.replay_uncached(node)), Cow::Borrowed)
    }

    /// Builds an engine hint without retaining boards beyond the current path.
    pub fn position_at_uncached(&self, node: NodeId, rules: &AnalysisRules) -> Option<Position> {
        self.position_from_state(node, &self.transient_state(node), rules)
    }

    fn position_from_state(
        &self,
        node: NodeId,
        state: &NodeState,
        rules: &AnalysisRules,
    ) -> Option<Position> {
        if state.illegal.is_some() {
            return None;
        }
        let base = state.base;
        let mut moves = Vec::new();
        let mut at = node;
        while at != base {
            let mv = self.states[at]
                .get()
                .map_or_else(|| self.recorded_move(at).ok().flatten(), |state| state.mv);
            if let Some(mv) = mv {
                moves.push(mv);
            }
            at = self.nodes[at].parent.expect("the base is an ancestor");
        }
        moves.reverse();

        let base_state = if base == node {
            Cow::Borrowed(state)
        } else {
            self.transient_state(base)
        };
        let n = usize::from(self.size.get());
        let setup: Vec<(Color, Point)> = base_state
            .board
            .stones()
            .iter()
            .enumerate()
            .filter_map(|(i, stone)| {
                stone.map(|c| {
                    let p = Point {
                        x: u8::try_from(i % n).expect("on the board"),
                        y: u8::try_from(i / n).expect("on the board"),
                    };
                    (c, p)
                })
            })
            .collect();
        let plain_root = base == self.root()
            && setup.is_empty()
            && self.nodes[base].sgf.get("PL").is_none()
            && base_state.mv.is_none();
        // The first move's colour when there is one (a file may continue with either colour
        // after setup stones), else whoever is to play at the base.
        let initial_player = if plain_root {
            None
        } else {
            Some(moves.first().map_or(base_state.to_play, |&(c, _)| c))
        };
        let mut position = Position::empty(self.size, rules.kata_rules(), rules.komi());
        position.setup = setup;
        position.moves = moves;
        position.initial_player = initial_player;
        Some(position)
    }

    /// The board after `moves` from `node`, colours alternating from the player to move there.
    /// The game is not changed.
    pub fn preview(&self, node: NodeId, moves: &[Move]) -> Preview {
        let mut board = self.board_at(node).clone();
        let mut color = self.to_play(node);
        let mut captured = Vec::with_capacity(moves.len());
        let mut illegal_at = None;
        for (i, &mv) in moves.iter().enumerate() {
            let result = board.play(color, mv, false);
            if result.illegal.is_some() && illegal_at.is_none() {
                illegal_at = Some(u32::try_from(i).unwrap_or(u32::MAX));
            }
            captured.push(result.captured);
            color = color.opponent();
        }
        Preview {
            stones: board.stones(),
            captured,
            illegal_at,
        }
    }

    /// The game as an SGF tree to write. `CA` becomes `UTF-8`, `FF` and `GM` are added when
    /// missing, and with `rules` (the user changed them) `RU` and `KM` are replaced.
    pub fn to_sgf(&self, rules: Option<&AnalysisRules>) -> SgfTree {
        let mut root = self.sgf(self.root).clone();
        set_prop(&mut root, "CA", "UTF-8");
        if root.get("FF").is_none() {
            root.push("FF", ["4".to_owned()]);
        }
        if root.get("GM").is_none() {
            root.push("GM", ["1".to_owned()]);
        }
        if let Some(rules) = rules {
            let kata = rules.kata_rules();
            let ru = match kata.preset() {
                Some(crate::Rules::Chinese) => "Chinese".to_owned(),
                Some(crate::Rules::Japanese | crate::Rules::Korean) => {
                    // A named Japanese RU with KM[0] is ambiguous on an even Fox record.
                    if rules.komi().points() == 0.0 && is_fox_even_game(&root) {
                        kata.katago_string()
                    } else {
                        "Japanese".to_owned()
                    }
                }
                // Existing named Tromp-Taylor records retain their legacy scoring-based reading.
                Some(crate::Rules::TrompTaylor) | None => kata.katago_string(),
            };
            set_prop(&mut root, "RU", &ru);
            set_prop(&mut root, "KM", &format_komi(rules.komi().points()));
        }

        // Each sequence is completed after its variations. The stack also handles deep trees.
        enum Visit {
            Head(NodeId),
            Finish(SgfTree, usize),
        }
        let mut visits = vec![Visit::Head(self.root)];
        let mut completed = Vec::new();
        let mut root = Some(root);
        while let Some(visit) = visits.pop() {
            match visit {
                Visit::Head(mut at) => {
                    let mut tree = SgfTree::default();
                    loop {
                        tree.nodes
                            .push(root.take().unwrap_or_else(|| self.sgf(at).clone()));
                        let mut children = self
                            .children(at)
                            .iter()
                            .copied()
                            .filter(|&c| self.is_attached(c) && !self.is_tryout(c));
                        match (children.next(), children.next()) {
                            (Some(only), None) => at = only,
                            (Some(first), Some(second)) => {
                                let fork: Vec<_> =
                                    [first, second].into_iter().chain(children).collect();
                                visits.push(Visit::Finish(tree, fork.len()));
                                visits.extend(fork.into_iter().rev().map(Visit::Head));
                                break;
                            }
                            _ => {
                                completed.push(tree);
                                break;
                            }
                        }
                    }
                }
                Visit::Finish(mut tree, children) => {
                    tree.variations = completed.split_off(completed.len() - children);
                    completed.push(tree);
                }
            }
        }
        completed.pop().expect("the root sequence was visited")
    }
}

/// Replaces a property's values with one value, or adds it at the end.
pub(super) fn set_prop(node: &mut SgfNode, id: &str, value: &str) {
    match node.props.iter_mut().find(|p| p.id == id) {
        Some(prop) => prop.values = vec![value.to_owned()],
        None => node.push(id, [value.to_owned()]),
    }
}

/// `7` for 7.0, `7.5` for 7.5.
pub fn format_komi(points: f64) -> String {
    if points.fract() == 0.0 {
        format!("{points:.0}")
    } else {
        format!("{points}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sgf::parse_sgf;

    fn game(text: &str) -> Game {
        let c = parse_sgf(text).unwrap();
        Game::from_sgf(c.games.into_iter().next().unwrap(), AnalysisRules::Chinese)
            .unwrap()
            .0
    }

    fn error(text: &str) -> GameError {
        let c = parse_sgf(text).unwrap();
        Game::from_sgf(c.games.into_iter().next().unwrap(), AnalysisRules::Chinese).unwrap_err()
    }

    fn pt(s: &str) -> Point {
        let b = s.as_bytes();
        Point {
            x: b[0] - b'a',
            y: b[1] - b'a',
        }
    }

    fn last(g: &Game) -> NodeId {
        *g.main_line().last().unwrap()
    }

    #[test]
    fn line_through_follows_first_children_after_the_tip() {
        let mut g = game("(;PB[old](;B[aa])(;B[bb](;W[cc])(;W[dd])))");
        assert_eq!(g.path_to(2), [0, 2]);
        assert_eq!(g.line_through(2), [0, 2, 3]);
        g.nodes[0].children.reverse();
        set_prop(&mut g.nodes[0].sgf, "PB", "new");
        g.invalidate(0);
        assert_eq!(g.main_line(), [0, 2, 3]);
        assert_eq!(g.info().black.as_deref(), Some("new"));
    }

    #[test]
    fn to_sgf_does_not_rely_on_id_order() {
        let mut g = game("(;C[root](;B[aa](;W[bb])(;W[cc]))(;B[dd]))");
        let original = g.to_sgf(None);
        let last = g.nodes.len() - 1;
        g.nodes.reverse();
        for node in &mut g.nodes {
            node.parent = node.parent.map(|p| last - p);
            for child in &mut node.children {
                *child = last - *child;
            }
        }
        g.root = last;
        g.invalidate(last);
        assert_eq!(g.root(), last);
        assert_eq!(g.main_line(), [4, 3, 2]);
        assert_eq!(g.to_sgf(None), original);
    }

    #[test]
    fn invalidate_recomputes_the_subtree_only() {
        let mut g = game("(;AB[aa](;B[aa];W[bb])(;B[aa]))");
        g.board_at(2);
        g.board_at(3);
        assert_eq!(g.illegal_nodes(), [1, 3]);
        set_prop(&mut g.nodes[1].sgf, "B", "bb");
        g.invalidate(1);
        assert!(g.states[0].get().is_some() && g.states[3].get().is_some());
        assert!(g.states[1].get().is_none() && g.states[2].get().is_none());
        assert_eq!(g.illegal_nodes(), [2, 3]);
        assert_eq!(g.illegal(2), Some(Illegal::Occupied));
        g.nodes[0].children.remove(0);
        g.nodes[1].attached = false;
        g.nodes[2].attached = false;
        g.invalidate(1);
        assert_eq!(g.illegal_nodes(), [3]);
    }

    #[test]
    fn invalidating_a_cold_leaf_keeps_ancestors_uncached() {
        let mut g = game(&format!("(;AB[aa]{};W[bb])", ";B[]".repeat(9999)));
        let tip = last(&g);
        set_prop(&mut g.nodes[tip].sgf, "W", "aa");
        g.invalidate(tip);
        assert_eq!(g.illegal_nodes(), [tip]);
        assert_eq!(g.states.iter().filter(|s| s.get().is_some()).count(), 0);
    }

    #[test]
    fn reading_line_moves_keeps_distant_nodes_uncached() {
        let g = game(&format!(
            "(;AB[aa]{};AB[aa];B[bad];W[tt])",
            ";C[note]".repeat(5000)
        ));
        let line = g.main_line();
        assert_eq!(line.iter().filter_map(|&id| g.last_move(id)).count(), 1);
        assert_eq!(
            g.next_move_on_line(line[0], &line[1..]),
            Some((5003, Move::Pass))
        );
        assert!(g.states[1..].iter().all(|state| state.get().is_none()));
    }

    #[test]
    fn distant_next_position_does_not_cache_intervening_nodes() {
        let g = game(&format!(
            "(;SZ[9];B[aa]{};PL[W];W[bb])",
            ";C[note]".repeat(5000)
        ));
        let tip = last(&g);
        let next = g
            .position_at_uncached(tip, &AnalysisRules::Chinese)
            .unwrap();
        assert_eq!(next.moves.len(), 2);
        assert!(g.states[1..].iter().all(|state| state.get().is_none()));
        assert_eq!(Some(next), g.position_at(tip, &AnalysisRules::Chinese));
    }

    #[test]
    fn illegal_scan_keeps_no_boards() {
        let comment = "x".repeat(2_000);
        let variation = format!("({};W[aa])", format!(";B[]C[{comment}]").repeat(19));
        let text = format!(
            "(;AB[aa]C[{}]{})",
            "x".repeat(1_000_000),
            variation.repeat(500)
        );
        assert!(text.len() >= 20_000_000);
        let mut g = game(&text);
        assert_eq!(g.nodes.len(), 10_001);
        assert!(g.has_illegal());
        assert_eq!(g.illegal_nodes().len(), 500);
        assert!(g.states.iter().all(|s| s.get().is_none()));
        for id in 0..g.nodes.len() {
            g.board_at(id);
        }
        let path = g.path_to(10_000);
        g.trim(&path);
        assert_eq!(
            g.states.iter().filter(|s| s.get().is_some()).count(),
            4096 + path.len()
        );
        assert!(path.iter().all(|&id| g.states[id].get().is_some()));
    }

    #[test]
    fn trim_keeps_the_path() {
        let mut g = game(&format!("(;({})(;B[bb]))", ";W[]".repeat(4100)));
        g.board_at(4100);
        g.board_at(4101);
        let path = g.path_to(4101);
        g.trim(&path);
        assert!(path.iter().all(|&id| g.states[id].get().is_some()));
        assert_eq!(g.states.iter().filter(|s| s.get().is_some()).count(), 4098);
        assert_eq!(g.move_number(4100), 4100);
    }

    #[test]
    fn to_sgf_skips_tryout_and_detached_nodes() {
        let mut g = game("(;C[root](;B[aa];W[dd])(;B[bb])(;B[cc]))");
        g.nodes[1].tryout = true;
        g.nodes[3].attached = false;
        assert!(g.is_tryout(1));
        assert!(!g.is_attached(3));
        assert_eq!(g.children(0), [1, 3, 4]);
        assert_eq!(g.to_sgf(None), game("(;C[root];B[cc])").to_sgf(None));
    }

    fn fox_zero_komi_round_trip(kata: crate::KataRules) {
        let fox = game("(;AP[foxwq]HA[0]RU[Japanese]KM[0];B[pd])");
        let original = fox.to_sgf(None);
        assert_eq!(
            read_rules(&original.nodes[0], AnalysisRules::Chinese)
                .rules
                .komi()
                .points(),
            6.5
        );
        let selected = AnalysisRules::Custom {
            komi: crate::Komi::new(0.0).unwrap(),
            scoring: crate::game::Scoring::Territory,
            details: Some(kata.into()),
        };
        let text = crate::sgf::write_sgf(&[fox.to_sgf(Some(&selected))]);
        let reopened = parse_sgf(&text).unwrap();
        let root = &reopened.games[0].nodes[0];
        assert_eq!(root.first("KM"), Some("0"));
        assert_eq!(root.first("RU"), Some(kata.katago_string().as_str()));
        assert!(
            read_rules(root, AnalysisRules::Chinese)
                .rules
                .same_effect(&selected)
        );
    }

    #[test]
    fn fox_zero_komi_with_custom_rules_survives_export() {
        fox_zero_komi_round_trip(crate::KataRules {
            tax: crate::TaxRule::All,
            ..crate::Rules::Japanese.into()
        });
    }

    #[test]
    fn fox_zero_komi_with_japanese_rules_survives_export() {
        fox_zero_komi_round_trip(crate::Rules::Japanese.into());
    }

    #[test]
    fn exact_tromp_taylor_survives_sgf_export() {
        let game = game("(;RU[koPOSITIONALscoreAREAtaxNONEsui1]KM[5])");
        let exact = read_rules(&game.to_sgf(None).nodes[0], AnalysisRules::Chinese).rules;
        let saved = game.to_sgf(Some(&exact));
        assert_eq!(
            saved.nodes[0].first("RU"),
            Some("koPOSITIONALscoreAREAtaxNONEsui1")
        );
        assert_eq!(
            read_rules(&saved.nodes[0], AnalysisRules::Chinese).rules,
            exact
        );
    }

    #[test]
    fn to_sgf_writes_the_preset_name_or_the_katago_string() {
        let g = game("(;SZ[19])");
        let root = &g.to_sgf(Some(&AnalysisRules::Chinese)).nodes[0];
        assert_eq!(root.first("RU"), Some("Chinese"));
        let input = game("(;RU[koPOSITIONALscoreAREAtaxALLsui1whbN]KM[7])");
        let rules = read_rules(&input.to_sgf(None).nodes[0], AnalysisRules::Chinese).rules;
        let root = &g.to_sgf(Some(&rules)).nodes[0];
        assert_eq!(
            root.first("RU"),
            Some("koPOSITIONALscoreAREAtaxALLsui1whbN")
        );
    }

    #[test]
    fn sizes() {
        assert_eq!(
            error("(;SZ[19:13])"),
            GameError::UnsupportedSize {
                width: 19,
                height: 13
            }
        );
        assert_eq!(
            error("(;SZ[21])"),
            GameError::UnsupportedSize {
                width: 21,
                height: 21
            }
        );
        assert_eq!(
            error("(;SZ[4])"),
            GameError::UnsupportedSize {
                width: 4,
                height: 4
            }
        );
        assert_eq!(error("(;GM[2])"), GameError::NotGo);
        assert_eq!(game("(;SZ[9])").size().get(), 9);
        assert_eq!(game("(;SZ[13:13])").size().get(), 13);
        assert_eq!(game("(;GN[x])").size().get(), 19);
    }

    #[test]
    fn main_line_follows_first_children() {
        let g = game("(;SZ[19];B[pd](;W[dd];B[pp])(;W[dp]))");
        assert_eq!(g.main_line().len(), 4);
        assert_eq!(g.last_move(last(&g)), Some(Move::Play(pt("pp"))));
        assert_eq!(g.move_number(last(&g)), 3);
    }

    #[test]
    fn move_numbers_count_passes_not_setup() {
        let g = game("(;SZ[19];B[pd];W[];B[tt];AB[aa];W[dd])");
        let numbers: Vec<_> = g.main_line().iter().map(|&n| g.move_number(n)).collect();
        assert_eq!(numbers, [0, 1, 2, 3, 3, 4]);
        assert_eq!(g.last_move(g.main_line()[2]), Some(Move::Pass));
        assert_eq!(g.last_move(g.main_line()[3]), Some(Move::Pass));
    }

    #[test]
    fn handicap_root() {
        let g = game("(;SZ[19]HA[3]AB[dd][pd][dp];W[pp])");
        let p = g.position_at(g.root(), &AnalysisRules::Chinese).unwrap();
        assert_eq!(p.initial_player, Some(Color::White));
        assert_eq!(p.setup.len(), 3);
        assert!(p.moves.is_empty());
        assert_eq!(g.to_play(g.root()), Color::White);
        let p = g.position_at(last(&g), &AnalysisRules::Chinese).unwrap();
        assert_eq!(p.moves, [(Color::White, Move::Play(pt("pp")))]);
        assert_eq!(g.info().handicap, Some(3));
    }

    #[test]
    fn plain_game_has_no_initial_player() {
        let g = game("(;SZ[19];B[pd])");
        let p = g
            .position_at(last(&g), &AnalysisRules::JapaneseKorean)
            .unwrap();
        assert_eq!(p.initial_player, None);
        assert!(p.setup.is_empty());
        assert_eq!(p.rules, crate::Rules::Japanese.into());
        assert_eq!(p.komi.points(), 6.5);
    }

    #[test]
    fn pl_sets_player() {
        let g = game("(;SZ[9]AB[dd]PL[W])");
        assert_eq!(g.to_play(g.root()), Color::White);
        let p = g.position_at(g.root(), &AnalysisRules::Chinese).unwrap();
        assert_eq!(p.initial_player, Some(Color::White));
    }

    #[test]
    fn mid_game_setup_rebases() {
        let g = game("(;SZ[19];B[pd];W[dd];AB[qq];W[pp])");
        let p = g.position_at(last(&g), &AnalysisRules::Chinese).unwrap();
        let mut setup = p.setup.clone();
        setup.sort_by_key(|&(_, q)| (q.y, q.x));
        assert_eq!(
            setup,
            [
                (Color::White, pt("dd")),
                (Color::Black, pt("pd")),
                (Color::Black, pt("qq")),
            ]
        );
        assert_eq!(p.initial_player, Some(Color::White));
        assert_eq!(p.moves, [(Color::White, Move::Play(pt("pp")))]);
    }

    #[test]
    fn illegal_move_rebases_later_nodes() {
        let g = game("(;SZ[19];B[pd];W[pd];B[dd])");
        let bad = g.main_line()[2];
        assert_eq!(g.illegal(bad), Some(Illegal::Occupied));
        assert!(g.has_illegal());
        assert_eq!(g.position_at(bad, &AnalysisRules::Chinese), None);
        let p = g.position_at(last(&g), &AnalysisRules::Chinese).unwrap();
        assert_eq!(p.setup, [(Color::White, pt("pd"))]);
        assert_eq!(p.moves, [(Color::Black, Move::Play(pt("dd")))]);
        assert_eq!(g.illegal(last(&g)), None);
    }

    #[test]
    fn off_board_move_is_flagged() {
        let g = game("(;SZ[9];B[pd])");
        assert_eq!(g.illegal(last(&g)), Some(Illegal::OffBoard));
    }

    #[test]
    fn last_move_and_captures() {
        let g = game("(;SZ[9];W[ba];B[aa];W[ca];B[bb];W[ee];B[cb];W[ff];B[da])");
        let b = g.board_at(last(&g));
        assert_eq!(b.get(pt("ba")), None);
        assert_eq!(b.get(pt("ca")), None);
        assert_eq!(b.captures(), (2, 0));
        assert_eq!(g.last_move(last(&g)), Some(Move::Play(pt("da"))));
    }

    #[test]
    fn preview() {
        let g = game("(;SZ[9];W[ba];B[aa];W[ca];B[bb];W[ee];B[cb])");
        let from = last(&g);
        assert_eq!(g.to_play(from), Color::White);
        let pv = g.preview(from, &[Move::Play(pt("gg")), Move::Play(pt("da"))]);
        assert_eq!(pv.captured.len(), 2);
        assert!(pv.captured[0].is_empty());
        assert_eq!(pv.captured[1].len(), 2);
        assert_eq!(pv.illegal_at, None);
        let n = 9;
        assert_eq!(
            pv.stones[usize::from(pt("gg").y) * n + usize::from(pt("gg").x)],
            Some(Color::White)
        );
        let pv = g.preview(from, &[Move::Play(pt("aa"))]);
        assert_eq!(pv.illegal_at, Some(0));
        // The game itself is untouched.
        assert_eq!(g.board_at(from).get(pt("gg")), None);
    }

    #[test]
    fn info_is_read() {
        let g = game(
            "(;SZ[19]PB[丁浩]PW[廖元赫]BR[9p]WR[9p]RE[W+R]DT[2025-11-17]EV[Samsung]RO[2]GN[g]PC[Seoul])",
        );
        let i = g.info();
        assert_eq!(i.black.as_deref(), Some("丁浩"));
        assert_eq!(i.white.as_deref(), Some("廖元赫"));
        assert_eq!(i.black_rank.as_deref(), Some("9p"));
        assert_eq!(i.result.as_deref(), Some("W+R"));
        assert_eq!(i.round.as_deref(), Some("2"));
        assert_eq!(i.place.as_deref(), Some("Seoul"));
    }

    #[test]
    fn to_sgf_keeps_everything() {
        let text =
            "(;CA[GB2312]SZ[19]LZ[a b c]XX[keep];B[pd]LZOP[1 2](;W[dd];B[pp])(;W[dp]C[var]))";
        let g = game(text);
        let tree = g.to_sgf(None);
        let original = parse_sgf(text).unwrap().games.remove(0);
        let root = &tree.nodes[0];
        assert_eq!(root.get("CA").unwrap().values, ["UTF-8"]);
        assert_eq!(root.props.iter().filter(|p| p.id == "CA").count(), 1);
        assert_eq!(root.first("FF"), Some("4"));
        assert_eq!(root.first("GM"), Some("1"));
        assert_eq!(root.first("LZ"), Some("a b c"));
        assert_eq!(root.first("XX"), Some("keep"));
        assert_eq!(tree.nodes[1].first("LZOP"), Some("1 2"));
        assert_eq!(tree.variations.len(), 2);
        assert_eq!(tree.variations[1], original.variations[1]);
        let changed = g.to_sgf(Some(&AnalysisRules::Custom {
            details: None,
            komi: crate::Komi::new(7.0).unwrap(),
            scoring: crate::game::Scoring::Territory,
        }));
        assert_eq!(changed.nodes[0].first("RU"), Some("Japanese"));
        assert_eq!(changed.nodes[0].first("KM"), Some("7"));
        let chinese = g.to_sgf(Some(&AnalysisRules::Chinese));
        assert_eq!(chinese.nodes[0].first("RU"), Some("Chinese"));
        assert_eq!(chinese.nodes[0].first("KM"), Some("7.5"));
    }

    #[test]
    fn a_long_game_builds_without_recursion() {
        let text = format!("(;SZ[19]{})", ";B[aa];W[bb];B[];W[]".repeat(1_500));
        let g = game(&text);
        assert_eq!(g.move_number(last(&g)), 6_000);
        assert!(g.position_at(last(&g), &AnalysisRules::Chinese).is_some());
    }
}
