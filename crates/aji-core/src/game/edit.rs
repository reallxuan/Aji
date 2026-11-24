//! Reversible changes to the SGF record.

use super::{Game, NodeId};
use crate::sgf::SgfProp;

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
}
