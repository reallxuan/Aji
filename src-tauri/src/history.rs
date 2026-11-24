//! Bounded edit history for an open game.

use std::collections::{HashSet, VecDeque};

use aji_core::game::{AnalysisRules, Change, Game, NodeId, Op};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Spot {
    pub current: NodeId,
    pub tip: NodeId,
    pub tryout: Option<NodeId>,
}

#[derive(Debug)]
pub enum EntryKind {
    Record(Change),
    Rules {
        before: AnalysisRules,
        after: AnalysisRules,
    },
}

#[derive(Debug)]
pub struct Entry {
    pub id: u64,
    pub kind: EntryKind,
    pub kept: bool,
    pub before: Spot,
    pub after: Spot,
}

impl Entry {
    /// Include indirect references such as the siblings saved by a reorder.
    fn visit_nodes(&self, mut visit: impl FnMut(NodeId)) {
        for spot in [self.before, self.after] {
            visit(spot.current);
            visit(spot.tip);
            if let Some(node) = spot.tryout {
                visit(node);
            }
        }
        if let EntryKind::Record(change) = &self.kind {
            visit(change.focus);
            for op in change.forward.iter().chain(&change.inverse) {
                match *op {
                    Op::Attach { node, parent, .. } => {
                        visit(node);
                        visit(parent);
                    }
                    Op::Detach { node }
                    | Op::SetProps { node, .. }
                    | Op::SetTryout { node, .. }
                    | Op::SetRoot { node } => visit(node),
                    Op::Reorder {
                        parent,
                        ref children,
                    } => {
                        visit(parent);
                        children.iter().copied().for_each(&mut visit);
                    }
                }
            }
        }
    }
}

#[derive(Default)]
pub struct History {
    entries: VecDeque<Entry>,
    applied: usize,
    next_id: u64,
    saved: u64,
    /// Last kept edit that became permanent when it left the undo window.
    base_kept: u64,
}

impl History {
    pub fn push(&mut self, kind: EntryKind, kept: bool, before: Spot, after: Spot) -> Vec<Entry> {
        let mut dropped: Vec<_> = self.entries.drain(self.applied..).collect();
        self.next_id += 1;
        self.entries.push_back(Entry {
            id: self.next_id,
            kind,
            kept,
            before,
            after,
        });
        if self.entries.len() > 1000 {
            let oldest = self.entries.pop_front().expect("nonempty history");
            if oldest.kept {
                self.base_kept = oldest.id;
            }
            dropped.push(oldest);
        }
        self.applied = self.entries.len();
        dropped
    }

    pub fn undo(&mut self) -> Option<&Entry> {
        self.applied = self.applied.checked_sub(1)?;
        self.entries.get(self.applied)
    }

    pub fn redo(&mut self) -> Option<&Entry> {
        let entry = self.entries.get(self.applied)?;
        self.applied += 1;
        Some(entry)
    }

    pub fn last_kept(&self) -> u64 {
        self.entries
            .range(..self.applied)
            .rev()
            .find(|e| e.kept)
            .map_or(self.base_kept, |e| e.id)
    }

    pub fn mark_saved(&mut self, id: u64) {
        self.saved = id;
    }

    pub fn changed(&self) -> bool {
        self.last_kept() != self.saved
    }

    /// A discarded entry may share a detached tree with a retained entry. Release a
    /// whole tree only after the last reference to any node within it leaves history.
    pub(crate) fn release_discarded(&self, game: &mut Game, discarded: Vec<Entry>) {
        let mut candidates = HashSet::new();
        for entry in discarded {
            entry.visit_nodes(|id| {
                if !game.is_attached(id) {
                    candidates.insert(id);
                }
            });
        }
        if candidates.is_empty() {
            return;
        }
        let root_of = |id| {
            std::iter::successors(Some(id), |&n| game.parent(n))
                .last()
                .unwrap()
        };
        let mut roots: HashSet<_> = candidates.into_iter().map(root_of).collect();
        let mut retained = HashSet::new();
        for entry in &self.entries {
            entry.visit_nodes(|id| {
                if !game.is_attached(id) {
                    retained.insert(id);
                }
            });
        }
        for id in retained {
            roots.remove(&root_of(id));
        }
        game.release(&roots.into_iter().collect::<Vec<_>>());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_holds_1000_entries() {
        let mut history = History::default();
        let spot = Spot {
            current: 0,
            tip: 0,
            tryout: None,
        };
        for i in 0..1001 {
            let kind = EntryKind::Record(Change {
                forward: vec![],
                inverse: vec![],
                focus: 0,
            });
            let discarded = history.push(kind, i == 0, spot, spot);
            assert_eq!(discarded.len(), usize::from(i == 1000));
        }
        history.mark_saved(1);
        for _ in 0..1000 {
            assert!(history.undo().is_some());
        }
        assert!(history.undo().is_none());
        assert_eq!(history.last_kept(), 1);
        assert!(!history.changed());
    }
}
