//! Reversible changes to the SGF record.

use super::record::{info_value, set_prop};
use super::{Game, Illegal, NodeId, expand_points};
use crate::sgf::{SgfNode, SgfProp};
use crate::{BoardSize, Color, Move, Point};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

/// One reversible edit to the arena. Structural operations preserve a forest of ordered trees.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    /// Link a parentless, detached tree at the given sibling index.
    Attach {
        node: NodeId,
        parent: NodeId,
        index: usize,
    },
    /// Unlink a non-root node while preserving all links within its subtree.
    Detach {
        node: NodeId,
    },
    SetProps {
        node: NodeId,
        props: Vec<SgfProp>,
    },
    SetTryout {
        node: NodeId,
        on: bool,
    },
    /// Make a parentless tree the record, detaching the previous root's tree.
    SetRoot {
        node: NodeId,
    },
    /// Supply a permutation of the existing children.
    Reorder {
        parent: NodeId,
        children: Vec<NodeId>,
    },
}

/// A compound edit. Both operation lists are stored in application order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub forward: Vec<Op>,
    pub inverse: Vec<Op>,
    pub focus: NodeId,
}

impl Game {
    pub fn undo(&mut self, change: &Change) {
        for op in &change.inverse {
            self.apply_op(op);
        }
    }

    pub fn redo(&mut self, change: &Change) {
        for op in &change.forward {
            self.apply_op(op);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "text", rename_all = "camelCase")]
#[ts(export)]
pub enum Mark {
    Triangle,
    Square,
    Circle,
    Cross,
    Label(String),
}

impl Mark {
    fn property(&self) -> &'static str {
        match self {
            Self::Triangle => "TR",
            Self::Square => "SQ",
            Self::Circle => "CR",
            Self::Cross => "MA",
            Self::Label(_) => "LB",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum InfoField {
    Black,
    White,
    BlackRank,
    WhiteRank,
    Result,
    Date,
    Event,
    Round,
    Place,
    GameName,
}

impl InfoField {
    fn property(self) -> &'static str {
        match self {
            Self::Black => "PB",
            Self::White => "PW",
            Self::BlackRank => "BR",
            Self::WhiteRank => "WR",
            Self::Result => "RE",
            Self::Date => "DT",
            Self::Event => "EV",
            Self::Round => "RO",
            Self::Place => "PC",
            Self::GameName => "GN",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Edit {
    Play {
        at: NodeId,
        color: Color,
        mv: Move,
        tryout: bool,
    },
    InsertMove {
        at: NodeId,
        color: Color,
        mv: Move,
    },
    Delete {
        node: NodeId,
    },
    Promote {
        node: NodeId,
    },
    MoveUp {
        node: NodeId,
    },
    SetComment {
        node: NodeId,
        text: Option<String>,
    },
    SetMark {
        node: NodeId,
        point: Point,
        mark: Option<Mark>,
    },
    ClearMarks {
        node: NodeId,
    },
    SetupStone {
        at: NodeId,
        point: Point,
        stone: Option<Color>,
    },
    MoveStone {
        at: NodeId,
        from: Point,
        to: Point,
    },
    SetToPlay {
        at: NodeId,
        color: Color,
    },
    Flatten {
        at: NodeId,
    },
    SetInfo {
        field: InfoField,
        value: Option<String>,
    },
    KeepTryout {
        node: NodeId,
    },
    DropTryout,
    /// Puts a node's own move on another point. Its children and every later move stay as they
    /// are; a later move this makes illegal is refused unless `allow_illegal` (move-last-move
    /// design).
    MovePlay {
        node: NodeId,
        to: Point,
        allow_illegal: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditError {
    Illegal(Illegal),
    NoSuchNode,
    NotTryout,
    /// How many later moves, legal before, a `MovePlay` would make illegal.
    LaterMovesIllegal(u32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placed {
    pub point: Point,
    pub node: NodeId,
    pub number: u32,
    pub branch_number: Option<u32>,
}

const MARKS: &[&str] = &["TR", "SQ", "CR", "MA", "LB"];
const SETUP: &[&str] = &["AB", "AW", "AE"];

fn sgf_point(p: Point) -> String {
    [char::from(b'a' + p.x), char::from(b'a' + p.y)]
        .into_iter()
        .collect()
}

fn setup_id(stone: Option<Color>) -> &'static str {
    match stone {
        Some(Color::Black) => "AB",
        Some(Color::White) => "AW",
        None => "AE",
    }
}

fn label(value: &str, size: BoardSize) -> Option<(Point, &str)> {
    let (coord, text) = value.split_once(':')?;
    let [point] = expand_points(coord.trim(), size)[..] else {
        return None;
    };
    Some((point, text))
}

/// Remove a point without normalising other values. Expand only rectangles containing it.
fn remove_point(sgf: &mut SgfNode, ids: &[&str], target: Point, size: BoardSize) {
    for prop in &mut sgf.props {
        if !ids.contains(&prop.id.as_str()) {
            continue;
        }
        if prop.id == "LB" {
            prop.values
                .retain(|v| label(v, size).is_none_or(|(p, _)| p != target));
        } else {
            let mut values = Vec::new();
            for value in std::mem::take(&mut prop.values) {
                let points = expand_points(value.trim(), size);
                if points.contains(&target) {
                    values.extend(points.into_iter().filter(|&p| p != target).map(sgf_point));
                } else {
                    values.push(value);
                }
            }
            prop.values = values;
        }
    }
    sgf.props
        .retain(|p| !ids.contains(&p.id.as_str()) || !p.values.is_empty());
}

impl Game {
    pub fn comment(&self, node: NodeId) -> Option<&str> {
        self.sgf(node).first("C")
    }

    pub fn marks(&self, node: NodeId) -> Vec<(Point, Mark)> {
        let mut marks = Vec::new();
        for prop in &self.sgf(node).props {
            let shape = match prop.id.as_str() {
                "TR" => Mark::Triangle,
                "SQ" => Mark::Square,
                "CR" => Mark::Circle,
                "MA" => Mark::Cross,
                "LB" => {
                    marks.extend(prop.values.iter().filter_map(|v| {
                        label(v, self.size()).map(|(p, text)| (p, Mark::Label(text.into())))
                    }));
                    continue;
                }
                _ => continue,
            };
            for v in &prop.values {
                marks.extend(
                    expand_points(v.trim(), self.size())
                        .into_iter()
                        .map(|p| (p, shape.clone())),
                );
            }
        }
        marks
    }

    /// Walk backwards from the final stones. The latest placement at each point wins,
    /// including setup replacing a stone or a later move reoccupying a captured point.
    pub fn placed_by(&self, node: NodeId) -> Vec<Placed> {
        let path = self.path_to(node);
        let base = path
            .windows(2)
            .rev()
            .find(|pair| self.children(pair[0]).first() != Some(&pair[1]))
            .map(|pair| self.move_number(pair[0]));
        let mut pending = self.board_at(node).stones();
        let size = self.size();
        let index = |p: Point| usize::from(p.y) * usize::from(size.get()) + usize::from(p.x);
        let mut placed = Vec::new();
        for id in path.into_iter().rev() {
            if let Some(Move::Play(point)) = self.last_move(id) {
                let stone = &mut pending[index(point)];
                if stone.is_some()
                    && *stone == self.last_color(id)
                    && self.illegal(id) != Some(Illegal::Suicide)
                {
                    let number = self.move_number(id);
                    placed.push(Placed {
                        point,
                        node: id,
                        number,
                        branch_number: base.filter(|&b| number > b).map(|b| number - b),
                    });
                    *stone = None;
                }
            }
            // In a mixed file node the setup happens before its move, hence this order.
            for prop in &self.sgf(id).props {
                if SETUP.contains(&prop.id.as_str()) {
                    for value in &prop.values {
                        for p in expand_points(value.trim(), size) {
                            pending[index(p)] = None;
                        }
                    }
                }
            }
        }
        placed.reverse();
        placed
    }

    pub fn edit(&mut self, edit: &Edit) -> Result<Change, EditError> {
        use Edit::*;
        let target = match *edit {
            Play { at, .. }
            | InsertMove { at, .. }
            | SetupStone { at, .. }
            | MoveStone { at, .. }
            | SetToPlay { at, .. }
            | Flatten { at } => at,
            Delete { node }
            | Promote { node }
            | MoveUp { node }
            | SetComment { node, .. }
            | SetMark { node, .. }
            | ClearMarks { node }
            | KeepTryout { node }
            | MovePlay { node, .. } => node,
            SetInfo { .. } | DropTryout => self.root(),
        };
        if !self.is_attached(target) {
            return Err(EditError::NoSuchNode);
        }

        let mut forward = Vec::new();
        let mut focus = target;
        match *edit {
            Play {
                at,
                color,
                mv,
                tryout,
            } => {
                if let Some(&child) = self
                    .children(at)
                    .iter()
                    .find(|&&c| self.last_move(c) == Some(mv) && self.last_color(c) == Some(color))
                {
                    focus = child;
                } else {
                    focus = self.new_move(at, color, mv, tryout)?;
                    forward.push(self.append_op(at, focus));
                }
            }
            InsertMove { at, color, mv } => {
                focus = self.new_move(at, color, mv, self.is_tryout(at))?;
                self.transfer_children(at, focus, &mut forward);
                forward.push(Op::Attach {
                    node: focus,
                    parent: at,
                    index: 0,
                });
            }
            Delete { node } => {
                if let Some(parent) = self.parent(node) {
                    forward.push(Op::Detach { node });
                    focus = parent;
                }
            }
            Promote { node } => {
                for pair in self.path_to(node).windows(2) {
                    if self.children(pair[0]).first() != Some(&pair[1]) {
                        let mut children = self.children(pair[0]).to_vec();
                        children.retain(|&n| n != pair[1]);
                        children.insert(0, pair[1]);
                        forward.push(Op::Reorder {
                            parent: pair[0],
                            children,
                        });
                    }
                }
            }
            MoveUp { node } => {
                if let Some(parent) = self.parent(node) {
                    let mut children = self.children(parent).to_vec();
                    let index = children
                        .iter()
                        .position(|&c| c == node)
                        .expect("parent lists child");
                    if index > 0 {
                        children.swap(index, index - 1);
                        forward.push(Op::Reorder { parent, children });
                    }
                }
            }
            SetComment { ref text, .. } => {
                self.edit_text(target, "C", text.as_deref(), &mut forward)
            }
            SetInfo { field, ref value } => {
                self.edit_text(target, field.property(), value.as_deref(), &mut forward)
            }
            SetMark {
                node,
                point,
                ref mark,
            } => {
                self.check_point(point)?;
                self.edit_mark(node, point, mark.as_ref(), &mut forward);
            }
            ClearMarks { node } => {
                let mut sgf = self.sgf(node).clone();
                sgf.props.retain(|prop| !MARKS.contains(&prop.id.as_str()));
                self.replace_props(node, sgf, &mut forward);
            }
            SetupStone { at, point, stone } => {
                self.check_point(point)?;
                let (mut sgf, parent) = self.setup_sgf(at);
                remove_point(&mut sgf, SETUP, point, self.size());
                if stone.is_some() || parent.is_some_and(|p| self.board_at(p).get(point).is_some())
                {
                    sgf.push(setup_id(stone), [sgf_point(point)]);
                }
                focus = self.write_setup(at, sgf, &mut forward);
            }
            MoveStone { at, from, to } => {
                self.check_point(from)?;
                self.check_point(to)?;
                if from != to
                    && let Some(color) = self.board_at(at).get(from)
                {
                    let (mut sgf, _) = self.setup_sgf(at);
                    for point in [from, to] {
                        remove_point(&mut sgf, SETUP, point, self.size());
                    }
                    sgf.push("AE", [sgf_point(from)]);
                    sgf.push(setup_id(Some(color)), [sgf_point(to)]);
                    focus = self.write_setup(at, sgf, &mut forward);
                }
            }
            SetToPlay { at, color } => {
                let (mut sgf, _) = self.setup_sgf(at);
                set_prop(&mut sgf, "PL", color.gtp());
                focus = self.write_setup(at, sgf, &mut forward);
            }
            Flatten { at } => {
                let mut sgf = self.sgf(self.root()).clone();
                sgf.props
                    .retain(|p| !matches!(p.id.as_str(), "B" | "W" | "AB" | "AW" | "AE" | "PL"));
                let size = self.size().get();
                for y in 0..size {
                    for x in 0..size {
                        let point = Point { x, y };
                        if let Some(color) = self.board_at(at).get(point) {
                            sgf.push(setup_id(Some(color)), [sgf_point(point)]);
                        }
                    }
                }
                sgf.push("PL", [self.to_play(at).gtp().into()]);
                focus = self.alloc(sgf.props, false);
                self.transfer_children(at, focus, &mut forward);
                forward.push(Op::SetRoot { node: focus });
            }
            KeepTryout { node } => {
                if !self.is_tryout(node) {
                    return Err(EditError::NotTryout);
                }
                for ancestor in self.path_to(node).into_iter().take_while(|&n| n != node) {
                    if self.is_tryout(ancestor) {
                        forward.push(Op::SetTryout {
                            node: ancestor,
                            on: false,
                        });
                    }
                }
                let mut stack = vec![node];
                while let Some(n) = stack.pop() {
                    if self.is_tryout(n) {
                        forward.push(Op::SetTryout { node: n, on: false });
                    }
                    stack.extend_from_slice(self.children(n));
                }
            }
            MovePlay {
                node,
                to,
                allow_illegal,
            } => {
                self.check_point(to)?;
                let Ok(Some((color, Move::Play(from)))) = self.recorded_move(node) else {
                    return Err(EditError::NoSuchNode);
                };
                if from != to {
                    let mut sgf = self.sgf(node).clone();
                    set_prop(&mut sgf, color.gtp(), &sgf_point(to));
                    let op = Op::SetProps {
                        node,
                        props: sgf.props,
                    };
                    // A trial: the record's own scan says whether the move and the later ones
                    // stay legal, setup in the same node included. Then it is undone.
                    let before: HashSet<NodeId> = self.illegal_nodes().iter().copied().collect();
                    let undo = self.apply_op(&op);
                    let own = self.illegal(node);
                    let later = self
                        .illegal_nodes()
                        .iter()
                        .filter(|&&n| n != node && !before.contains(&n))
                        .count();
                    self.apply_op(&undo);
                    if let Some(reason) = own {
                        return Err(EditError::Illegal(reason));
                    }
                    if later > 0 && !allow_illegal {
                        return Err(EditError::LaterMovesIllegal(
                            u32::try_from(later).unwrap_or(u32::MAX),
                        ));
                    }
                    forward.push(op);
                }
            }
            DropTryout => {
                let mut stack = vec![self.root()];
                while let Some(parent) = stack.pop() {
                    for &node in self.children(parent) {
                        if self.is_tryout(node) {
                            forward.push(Op::Detach { node });
                        } else {
                            stack.push(node);
                        }
                    }
                }
            }
        }
        let mut inverse: Vec<_> = forward.iter().map(|op| self.apply_op(op)).collect();
        inverse.reverse();
        Ok(Change {
            forward,
            inverse,
            focus,
        })
    }

    fn check_point(&self, p: Point) -> Result<(), EditError> {
        if p.x < self.size().get() && p.y < self.size().get() {
            Ok(())
        } else {
            Err(EditError::Illegal(Illegal::OffBoard))
        }
    }

    fn new_move(
        &mut self,
        at: NodeId,
        color: Color,
        mv: Move,
        tryout: bool,
    ) -> Result<NodeId, EditError> {
        if let Some(reason) = self.board_at(at).clone().play(color, mv, false).illegal {
            return Err(EditError::Illegal(reason));
        }
        let value = match mv {
            Move::Pass => String::new(),
            Move::Play(p) => sgf_point(p),
        };
        let mut sgf = SgfNode::default();
        sgf.push(color.gtp(), [value]);
        Ok(self.alloc(sgf.props, tryout))
    }

    fn append_op(&self, parent: NodeId, node: NodeId) -> Op {
        Op::Attach {
            parent,
            node,
            index: self.children(parent).len(),
        }
    }

    fn transfer_children(&self, from: NodeId, to: NodeId, ops: &mut Vec<Op>) {
        for (index, &node) in self.children(from).iter().enumerate() {
            ops.push(Op::Detach { node });
            ops.push(Op::Attach {
                parent: to,
                node,
                index,
            });
        }
    }

    fn replace_props(&self, node: NodeId, sgf: SgfNode, ops: &mut Vec<Op>) {
        if self.sgf(node) != &sgf {
            ops.push(Op::SetProps {
                node,
                props: sgf.props,
            });
        }
    }

    fn edit_mark(&self, node: NodeId, point: Point, mark: Option<&Mark>, ops: &mut Vec<Op>) {
        let current = self.marks(node);
        let at_point = current.iter().filter(|(p, _)| *p == point).map(|(_, m)| m);
        if at_point.eq(mark) {
            return;
        }

        let mut sgf = self.sgf(node).clone();
        remove_point(&mut sgf, MARKS, point, self.size());
        if let Some(mark) = mark {
            let mut value = sgf_point(point);
            if let Mark::Label(text) = mark {
                value.push(':');
                value.push_str(text);
            }
            sgf.push(mark.property(), [value]);
        }
        self.replace_props(node, sgf, ops);
    }

    fn edit_text(&self, node: NodeId, id: &str, value: Option<&str>, ops: &mut Vec<Op>) {
        let first = self.sgf(node).first(id);
        let unchanged = if id == "C" {
            first == value
        } else {
            info_value(first) == info_value(value)
        };
        if unchanged {
            return;
        }

        let mut sgf = self.sgf(node).clone();
        if let Some(value) = value.filter(|v| !v.is_empty()) {
            set_prop(&mut sgf, id, value);
        } else {
            sgf.props.retain(|p| p.id != id);
        }
        self.replace_props(node, sgf, ops);
    }

    fn has_move_property(&self, node: NodeId) -> bool {
        self.sgf(node).get("B").is_some() || self.sgf(node).get("W").is_some()
    }

    /// Properties to edit and the node whose board the setup inherits.
    fn setup_sgf(&self, at: NodeId) -> (SgfNode, Option<NodeId>) {
        if self.has_move_property(at) {
            (SgfNode::default(), Some(at))
        } else {
            (self.sgf(at).clone(), self.parent(at))
        }
    }

    fn write_setup(&mut self, at: NodeId, sgf: SgfNode, ops: &mut Vec<Op>) -> NodeId {
        if self.has_move_property(at) {
            let node = self.alloc(sgf.props, self.is_tryout(at));
            ops.push(self.append_op(at, node));
            node
        } else {
            self.replace_props(at, sgf, ops);
            at
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{AnalysisRules, Game};
    use crate::sgf::{SgfProp, parse_sgf, write_sgf};

    const ODD: &str = "(;FF[4]GM[1]CA[UTF-8]SZ[9]AB[aa]PL[W]XX[unknown];B[tt][bb]AW[cc]\n(;W[aa];B[dd])\n(;W[ee]XY[keep]))\n";

    fn game() -> Game {
        Game::from_sgf(
            parse_sgf(ODD).unwrap().games.remove(0),
            AnalysisRules::Chinese,
        )
        .unwrap()
        .0
    }

    fn props(id: &str, value: &str) -> Vec<SgfProp> {
        vec![SgfProp {
            id: id.into(),
            values: vec![value.into()],
        }]
    }

    fn written(g: &Game) -> String {
        write_sgf(&[g.to_sgf(None)])
    }

    fn change(g: &mut Game, forward: Vec<Op>, focus: usize) -> Change {
        let mut inverse: Vec<_> = forward.iter().map(|op| g.apply_op(op)).collect();
        inverse.reverse();
        Change {
            forward,
            inverse,
            focus,
        }
    }

    #[test]
    fn each_op_then_its_inverse_is_identity() {
        let mut g = game();
        let n = g.alloc(props("C", "new"), false);
        for op in [
            Op::Attach {
                node: n,
                parent: 1,
                index: 1,
            },
            Op::Detach { node: 2 },
            Op::SetProps {
                node: 1,
                props: props("C", "replacement"),
            },
            Op::SetTryout { node: 2, on: true },
            Op::SetRoot { node: n },
            Op::Reorder {
                parent: 1,
                children: vec![4, 2],
            },
        ] {
            let inverse = g.apply_op(&op);
            assert_ne!(written(&g), ODD);
            assert_eq!(g.apply_op(&inverse), op);
            assert_eq!(written(&g), ODD);
            assert_eq!(g.illegal_nodes(), [2]);
            assert_eq!(g.main_line(), [0, 1, 2, 3]);
            assert!(!g.is_attached(n));
        }
    }

    #[test]
    fn undo_restores_odd_records_byte_for_byte() {
        let mut g = game();
        let mut seed = 0x5a17_1ba3u32;
        let mut history = Vec::new();
        for i in 0..200 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let node = 2 + (seed as usize >> 16) % 3;
            let op = match seed >> 30 {
                0 => Op::SetProps {
                    node,
                    props: props("C", &i.to_string()),
                },
                1 => Op::SetTryout {
                    node,
                    on: !g.is_tryout(node),
                },
                2 => Op::Reorder {
                    parent: 1,
                    children: g.children(1).iter().rev().copied().collect(),
                },
                _ if g.is_attached(4) => Op::Detach { node: 4 },
                _ => Op::Attach {
                    node: 4,
                    parent: 1,
                    index: 0,
                },
            };
            history.push(change(&mut g, vec![op], node));
        }
        for entry in history.iter().rev() {
            g.undo(entry);
        }
        assert_eq!(written(&g), ODD);
    }

    fn insert(g: &mut Game) -> Change {
        let n = g.alloc(props("B", "ee"), false);
        change(
            g,
            vec![
                Op::Detach { node: 4 },
                Op::Attach {
                    node: 4,
                    parent: n,
                    index: 0,
                },
                Op::Attach {
                    node: n,
                    parent: 1,
                    index: 1,
                },
            ],
            n,
        )
    }

    #[test]
    fn redo_after_undo_equals_the_first_application() {
        let mut g = game();
        let _ = g.board_at(4);
        let c = insert(&mut g);
        let first = written(&g);
        assert_eq!(g.illegal_nodes(), [2, 4]);
        g.undo(&c);
        assert_eq!(written(&g), ODD);
        assert_eq!(g.illegal_nodes(), [2]);
        g.redo(&c);
        assert_eq!(written(&g), first);
        assert_eq!(g.illegal_nodes(), [2, 4]);
    }

    #[test]
    fn ids_survive_undo_and_redo() {
        let mut g = game();
        let c = insert(&mut g);
        assert_eq!(g.path_to(4), [0, 1, c.focus, 4]);
        g.undo(&c);
        assert_eq!(g.path_to(4), [0, 1, 4]);
        assert!(!g.is_attached(c.focus));
        g.redo(&c);
        assert_eq!(g.path_to(4), [0, 1, c.focus, 4]);
        assert!(g.is_attached(4));
    }

    #[test]
    fn release_empties_discarded_subtrees_and_preserves_attached_nodes() {
        let mut g = game();
        g.apply_op(&Op::Detach { node: 2 });
        assert!(!g.is_attached(3));
        assert_eq!(g.sgf(3).first("B"), Some("dd"));
        g.release(&[2, 4]);
        assert!(g.sgf(2).props.is_empty());
        assert!(g.sgf(3).props.is_empty());
        assert!(g.children(2).is_empty());
        assert_eq!(g.sgf(4).first("XY"), Some("keep"));
        assert!(g.alloc(vec![], true) > 4);
    }
    use crate::Color::{Black, White};

    fn record(input: &str) -> Game {
        Game::from_sgf(
            parse_sgf(input).unwrap().games.remove(0),
            AnalysisRules::Chinese,
        )
        .unwrap()
        .0
    }

    fn pt(value: &str) -> Point {
        let bytes = value.as_bytes();
        Point {
            x: bytes[0] - b'a',
            y: bytes[1] - b'a',
        }
    }

    fn play(at: NodeId, color: Color, value: &str) -> Edit {
        Edit::Play {
            at,
            color,
            mv: Move::Play(pt(value)),
            tryout: false,
        }
    }

    #[test]
    fn play_enters_a_matching_child() {
        let mut g = game();
        let c = g
            .edit(&Edit::Play {
                at: 0,
                color: Black,
                mv: Move::Pass,
                tryout: false,
            })
            .unwrap();
        assert_eq!(c.focus, 1);
        assert!(c.forward.is_empty());
        let c = g.edit(&play(1, White, "aa")).unwrap(); // Existing illegal file move.
        assert_eq!(c.focus, 2);
        assert!(c.inverse.is_empty());
        assert_eq!(written(&g), ODD);
    }

    #[test]
    fn play_appends_a_new_variation() {
        let mut g = game();
        let c = g.edit(&play(1, Black, "ee")).unwrap();
        assert_eq!(g.children(1), [2, 4, c.focus]);
        assert_eq!(g.sgf(c.focus).first("B"), Some("ee"));
    }

    #[test]
    fn play_refuses_an_occupied_point_and_a_suicide() {
        let mut g = record("(;SZ[9]AW[ab][ba])");
        let before = written(&g);
        for (point, reason) in [
            ("ab", Illegal::Occupied),
            ("aa", Illegal::Suicide),
            ("jj", Illegal::OffBoard),
        ] {
            assert_eq!(
                g.edit(&play(0, Black, point)),
                Err(EditError::Illegal(reason))
            );
        }
        assert_eq!(written(&g), before);
    }

    #[test]
    fn insert_keeps_the_rest_of_the_line_and_flags_new_illegal_moves() {
        let mut g = game();
        let c = g
            .edit(&Edit::InsertMove {
                at: 1,
                color: Black,
                mv: Move::Play(pt("ee")),
            })
            .unwrap();
        assert_eq!(g.children(1), [c.focus]);
        assert_eq!(g.children(c.focus), [2, 4]);
        assert_eq!(g.illegal_nodes(), [2, 4]);
    }

    #[test]
    fn promote_makes_the_path_the_main_line() {
        let mut g = record("(;SZ[9](;B[aa])(;B[bb](;W[cc])(;W[dd])))");
        g.edit(&Edit::Promote { node: 4 }).unwrap();
        assert_eq!(g.main_line(), [0, 2, 4]);
        assert_eq!(g.children(0), [2, 1]);
        assert_eq!(g.children(2), [4, 3]);
    }

    #[test]
    fn move_up_swaps_letters() {
        let mut g = record("(;SZ[9](;B[aa])(;B[bb])(;B[cc]))");
        g.edit(&Edit::MoveUp { node: 3 }).unwrap();
        assert_eq!(g.children(0), [1, 3, 2]);
    }

    fn setup(g: &mut Game, at: NodeId, point: &str, stone: Option<Color>) -> NodeId {
        g.edit(&Edit::SetupStone {
            at,
            point: pt(point),
            stone,
        })
        .unwrap()
        .focus
    }

    #[test]
    fn setup_on_a_move_node_starts_a_variation() {
        let mut g = game();
        let n = setup(&mut g, 1, "ff", Some(White));
        assert_eq!(g.children(1), [2, 4, n]);
        assert_eq!(g.sgf(n).first("AW"), Some("ff"));
        assert_eq!(g.board_at(2).get(pt("ff")), None);
        let pl = g
            .edit(&Edit::SetToPlay {
                at: 1,
                color: Black,
            })
            .unwrap();
        assert_eq!(g.parent(pl.focus), Some(1));
        assert_eq!(g.sgf(pl.focus).first("PL"), Some("B"));
    }

    #[test]
    fn setup_on_a_setup_node_edits_in_place() {
        let mut g = record("(;SZ[9]XX[keep]AB[aa:bb]XY[keep])");
        assert_eq!(setup(&mut g, 0, "ab", Some(White)), 0);
        assert_eq!(g.board_at(0).get(pt("ab")), Some(White));
        assert_eq!(g.sgf(0).get("AB").unwrap().values, ["aa", "ba", "bb"]);
        assert_eq!(g.sgf(0).get("AW").unwrap().values, ["ab"]);
    }

    #[test]
    fn remove_uses_ae_or_drops_from_ab() {
        let mut g = record("(;SZ[9]AB[aa];AB[bb])");
        setup(&mut g, 1, "bb", None);
        assert!(g.sgf(1).get("AB").is_none());
        assert!(g.sgf(1).get("AE").is_none());
        setup(&mut g, 1, "aa", None);
        assert_eq!(g.sgf(1).first("AE"), Some("aa"));
    }

    fn move_play(g: &mut Game, node: NodeId, to: &str, allow: bool) -> Result<Change, EditError> {
        g.edit(&Edit::MovePlay {
            node,
            to: pt(to),
            allow_illegal: allow,
        })
    }

    #[test]
    fn move_play_changes_only_the_point_and_keeps_later_moves() {
        let mut g = record("(;SZ[9];B[aa]C[note];W[bb];B[cc])");
        let change = move_play(&mut g, 1, "dd", false).unwrap();
        assert_eq!(change.focus, 1);
        assert_eq!(g.sgf(1).first("B"), Some("dd"));
        assert_eq!(g.sgf(1).first("C"), Some("note"));
        assert_eq!(g.children(1), [2]);
        assert_eq!(g.board_at(3).get(pt("dd")), Some(Black));
        assert_eq!(g.board_at(3).get(pt("aa")), None);
        g.undo(&change);
        assert_eq!(g.sgf(1).first("B"), Some("aa"));
        g.redo(&change);
        assert_eq!(g.sgf(1).first("B"), Some("dd"));
    }

    #[test]
    fn move_play_recomputes_its_captures() {
        // White's stone at ba has one liberty left, at ca, once Black's move lands there.
        let mut g = record("(;SZ[9]AW[ba]AB[aa][bb];B[ee])");
        move_play(&mut g, 1, "ca", false).unwrap();
        assert_eq!(g.board_at(1).get(pt("ba")), None);
    }

    #[test]
    fn move_play_refuses_an_illegal_point_and_changes_nothing() {
        let mut g = record("(;SZ[9];B[aa];W[bb];B[cc])");
        assert_eq!(
            move_play(&mut g, 3, "bb", true),
            Err(EditError::Illegal(Illegal::Occupied))
        );
        assert_eq!(g.sgf(3).first("B"), Some("cc"));
        assert_eq!(
            move_play(&mut g, 3, "zz", true),
            Err(EditError::Illegal(Illegal::OffBoard))
        );
    }

    #[test]
    fn move_play_counts_later_moves_it_would_make_illegal() {
        let mut g = record("(;SZ[9];B[aa];W[bb](;B[cc])(;B[dd];W[cc]))");
        assert!(g.illegal_nodes().is_empty());
        assert_eq!(
            move_play(&mut g, 1, "cc", false),
            Err(EditError::LaterMovesIllegal(2))
        );
        assert_eq!(g.sgf(1).first("B"), Some("aa"));
        assert!(g.illegal_nodes().is_empty());
        let change = move_play(&mut g, 1, "cc", true).unwrap();
        assert_eq!(g.illegal_nodes(), [3, 5]);
        g.undo(&change);
        assert!(g.illegal_nodes().is_empty());
    }

    #[test]
    fn move_play_needs_a_played_move() {
        let mut g = record("(;SZ[9];B[aa];W[])");
        assert_eq!(
            move_play(&mut g, 2, "cc", false),
            Err(EditError::NoSuchNode)
        );
        assert_eq!(
            move_play(&mut g, 0, "cc", false),
            Err(EditError::NoSuchNode)
        );
        assert!(
            move_play(&mut g, 1, "aa", false)
                .unwrap()
                .forward
                .is_empty()
        );
    }

    #[test]
    fn move_stone_is_ae_plus_ab() {
        let mut g = record("(;SZ[9];B[aa];W[bb])");
        let n = g
            .edit(&Edit::MoveStone {
                at: 1,
                from: pt("aa"),
                to: pt("cc"),
            })
            .unwrap()
            .focus;
        assert_eq!(g.sgf(n).first("AE"), Some("aa"));
        assert_eq!(g.sgf(n).first("AB"), Some("cc"));
        assert_eq!(g.board_at(2).get(pt("aa")), Some(Black));
    }

    #[test]
    fn one_mark_per_point() {
        let mut g = record("(;SZ[9]XX[a][b]TR[aa:bb][bad]XY[c]LB[ab:x][cc:y])");
        g.edit(&Edit::SetMark {
            node: 0,
            point: pt("ab"),
            mark: Some(Mark::Cross),
        })
        .unwrap();
        assert_eq!(
            g.sgf(0).get("TR").unwrap().values,
            ["aa", "ba", "bb", "bad"]
        );
        assert_eq!(g.sgf(0).get("LB").unwrap().values, ["cc:y"]);
        assert_eq!(
            g.marks(0)
                .iter()
                .filter(|(p, _)| *p == pt("ab"))
                .collect::<Vec<_>>(),
            [&(pt("ab"), Mark::Cross)]
        );
        g.edit(&Edit::SetMark {
            node: 0,
            point: pt("ab"),
            mark: None,
        })
        .unwrap();
        assert!(g.sgf(0).get("MA").is_none());
        g.edit(&Edit::ClearMarks { node: 0 }).unwrap();
        assert!(g.marks(0).is_empty());
        assert_eq!(
            g.sgf(0)
                .props
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>(),
            ["SZ", "XX", "XY"]
        );
        assert_eq!(g.sgf(0).get("XX").unwrap().values, ["a", "b"]);
    }

    fn assert_unchanged_edit(game: &mut Game, edit: Edit, focus: NodeId) {
        let before = written(game);
        let change = game.edit(&edit).unwrap();
        assert_eq!(change.forward, []);
        assert_eq!(change.inverse, []);
        assert_eq!(change.focus, focus);
        assert_eq!(written(game), before);
    }

    #[test]
    fn unchanged_imported_marks_preserve_value_order_and_rectangles() {
        let mut g = record("(;SZ[9];XX[keep]TR[aa][bb]SQ[cc:ee]LB[ff:A][gg:B])");
        for (coord, mark) in [
            ("aa", Mark::Triangle),
            ("dc", Mark::Square),
            ("ff", Mark::Label("A".into())),
        ] {
            assert_unchanged_edit(
                &mut g,
                Edit::SetMark {
                    node: 1,
                    point: pt(coord),
                    mark: Some(mark),
                },
                1,
            );
        }
    }

    #[test]
    fn unchanged_imported_comment_preserves_all_values() {
        let mut g = record("(;SZ[9];XX[a]C[ first ][second]XY[b])");
        let text = g.comment(1).map(str::to_owned);
        assert_unchanged_edit(&mut g, Edit::SetComment { node: 1, text }, 1);
    }

    #[test]
    fn unchanged_imported_info_preserves_all_values_and_spacing() {
        let mut g = record("(;SZ[9]PB[ Lee ][other]XX[keep]DT[2026][extra])");
        let info = g.info();
        for (field, value) in [(InfoField::Black, info.black), (InfoField::Date, info.date)] {
            assert_unchanged_edit(&mut g, Edit::SetInfo { field, value }, 0);
        }
    }

    #[test]
    fn labels_round_trip_lb() {
        let mut g = game();
        let label = Mark::Label("A: ]".into());
        g.edit(&Edit::SetMark {
            node: 1,
            point: pt("ac"),
            mark: Some(label.clone()),
        })
        .unwrap();
        let reopened = record(&written(&g));
        assert_eq!(reopened.sgf(1).first("LB"), Some("ac:A: ]"));
        assert_eq!(reopened.marks(1), [(pt("ac"), label)]);
    }

    #[test]
    fn flatten_keeps_info_and_continuations() {
        let mut g = record("(;SZ[9]PB[Lee]XX[x][y]AB[aa]B[bb]PL[B];W[cc](;B[dd])(;B[ee]))");
        let n = g.edit(&Edit::Flatten { at: 1 }).unwrap().focus;
        assert_eq!(g.root(), n);
        assert_eq!(g.children(n), [2, 3]);
        assert_eq!(g.sgf(n).get("AB").unwrap().values, ["aa", "bb"]);
        assert_eq!(g.sgf(n).first("AW"), Some("cc"));
        assert_eq!(g.sgf(n).first("PL"), Some("B"));
        assert!(g.sgf(n).get("B").is_none());
        assert_eq!(g.info().black.as_deref(), Some("Lee"));
        assert_eq!(g.sgf(n).get("XX").unwrap().values, ["x", "y"]);
        assert!(g.placed_by(n).is_empty());
    }

    fn try_play(g: &mut Game, at: NodeId, value: &str) -> NodeId {
        g.edit(&Edit::Play {
            at,
            color: g.to_play(at),
            mv: Move::Play(pt(value)),
            tryout: true,
        })
        .unwrap()
        .focus
    }

    #[test]
    fn keep_tryout_keeps_path_and_subtree_only() {
        let mut g = game();
        let a = try_play(&mut g, 1, "gg");
        let b = try_play(&mut g, a, "hh");
        let c = try_play(&mut g, a, "ii");
        let d = try_play(&mut g, b, "ff");
        g.edit(&Edit::KeepTryout { node: b }).unwrap();
        assert!([a, b, d].iter().all(|&n| !g.is_tryout(n)));
        assert!(g.is_tryout(c));
        assert_eq!(
            g.edit(&Edit::KeepTryout { node: 0 }),
            Err(EditError::NotTryout)
        );
    }

    #[test]
    fn drop_tryout_detaches_tryout_tops() {
        let mut g = game();
        let a = try_play(&mut g, 1, "gg");
        let b = try_play(&mut g, a, "hh");
        let c = try_play(&mut g, 4, "ii");
        let change = g.edit(&Edit::DropTryout).unwrap();
        assert_eq!(change.forward.len(), 2);
        assert!([a, b, c].iter().all(|&n| !g.is_attached(n)));
        assert_eq!(g.parent(b), Some(a));
        g.undo(&change);
        assert!(
            [a, b, c]
                .iter()
                .all(|&n| g.is_attached(n) && g.is_tryout(n))
        );
    }

    #[test]
    fn placed_by_names_each_stones_move_and_branch_number() {
        let g =
            record("(;SZ[9]AW[ba];B[aa];W[ab](;B[])(;C[branch];B[dd](;W[])(;W[ee];B[];W[ff])))");
        let mut placed = g.placed_by(9);
        placed.sort_by_key(|p| p.number);
        let expected = [
            ("ab", 2, 2, None),
            ("dd", 5, 3, None),
            ("ee", 7, 4, Some(1)),
            ("ff", 9, 6, Some(3)),
        ];
        assert_eq!(
            placed,
            expected.map(|(s, node, number, branch_number)| Placed {
                point: pt(s),
                node,
                number,
                branch_number
            })
        );
        assert_eq!(
            g.placed_by(5)
                .iter()
                .find(|p| p.node == 5)
                .unwrap()
                .branch_number,
            Some(1)
        );
        let g = record("(;SZ[9];B[aa];AW[aa];AB[aa];W[bb]AE[aa];B[aa])");
        let placed = g.placed_by(3);
        assert!(placed.is_empty());
        assert_eq!(
            g.placed_by(5)
                .iter()
                .find(|p| p.point == pt("aa"))
                .unwrap()
                .node,
            5
        );
    }

    #[test]
    fn comments_and_info_edit_the_named_property() {
        let mut g = record("(;SZ[9]XX[a]PB[Old]XY[b];C[text])");
        g.edit(&Edit::SetInfo {
            field: InfoField::Black,
            value: Some("New".into()),
        })
        .unwrap();
        assert_eq!(
            g.sgf(0)
                .props
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>(),
            ["SZ", "XX", "PB", "XY"]
        );
        assert_eq!(g.info().black.as_deref(), Some("New"));
        g.edit(&Edit::SetComment {
            node: 1,
            text: Some("new".into()),
        })
        .unwrap();
        assert_eq!(g.comment(1), Some("new"));
        g.edit(&Edit::SetComment {
            node: 1,
            text: None,
        })
        .unwrap();
        assert_eq!(g.comment(1), None);
    }

    #[test]
    fn stale_or_unknown_targets_are_refused() {
        let mut g = game();
        let c = g.edit(&Edit::Delete { node: 2 }).unwrap();
        assert_eq!(c.focus, 1);
        for node in [3, usize::MAX] {
            assert_eq!(
                g.edit(&Edit::ClearMarks { node }),
                Err(EditError::NoSuchNode)
            );
        }
    }

    #[test]
    fn every_edit_undoes_exactly() {
        let edits = [
            play(1, Black, "ff"),
            Edit::InsertMove {
                at: 1,
                color: White,
                mv: Move::Pass,
            },
            Edit::Delete { node: 2 },
            Edit::Promote { node: 4 },
            Edit::MoveUp { node: 4 },
            Edit::SetComment {
                node: 1,
                text: Some("comment".into()),
            },
            Edit::SetMark {
                node: 1,
                point: pt("aa"),
                mark: Some(Mark::Square),
            },
            Edit::ClearMarks { node: 1 },
            Edit::SetupStone {
                at: 1,
                point: pt("aa"),
                stone: None,
            },
            Edit::MoveStone {
                at: 1,
                from: pt("cc"),
                to: pt("gg"),
            },
            Edit::SetToPlay {
                at: 1,
                color: Black,
            },
            Edit::Flatten { at: 1 },
            Edit::SetInfo {
                field: InfoField::WhiteRank,
                value: Some("9p".into()),
            },
            Edit::KeepTryout { node: 5 },
            Edit::DropTryout,
        ];
        for edit in edits {
            let mut g = game();
            if matches!(edit, Edit::ClearMarks { .. }) {
                g.edit(&Edit::SetMark {
                    node: 1,
                    point: pt("aa"),
                    mark: Some(Mark::Triangle),
                })
                .unwrap();
            }
            let n = try_play(&mut g, 1, "ii");
            let before = written(&g);
            let c = g.edit(&edit).unwrap();
            assert!(!c.forward.is_empty(), "{edit:?}");
            let after = written(&g);
            g.undo(&c);
            assert_eq!(written(&g), before, "{edit:?}");
            assert!(g.is_attached(n) && g.is_tryout(n));
            g.redo(&c);
            assert_eq!(written(&g), after, "{edit:?}");
        }
    }
}
