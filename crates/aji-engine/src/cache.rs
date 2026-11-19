//! An in-memory cache keeping the most-visited analysis per position, bounded by evicting
//! the least recently used position.

use std::collections::HashMap;

use aji_core::PositionKey;

use crate::update::AnalysisUpdate;

/// Positions kept by `AnalysisCache::new`.
pub const DEFAULT_CACHE_ENTRIES: usize = 1_024;

#[derive(Debug)]
pub struct AnalysisCache {
    capacity: usize,
    /// Each entry with the tick of its last use.
    entries: HashMap<PositionKey, (AnalysisUpdate, u64)>,
    tick: u64,
}

impl Default for AnalysisCache {
    fn default() -> Self {
        AnalysisCache::with_capacity(DEFAULT_CACHE_ENTRIES)
    }
}

impl AnalysisCache {
    pub fn new() -> AnalysisCache {
        AnalysisCache::default()
    }

    /// A cache of at most `capacity` positions (at least one).
    pub fn with_capacity(capacity: usize) -> AnalysisCache {
        AnalysisCache {
            capacity: capacity.max(1),
            entries: HashMap::new(),
            tick: 0,
        }
    }

    /// Stores `update` when there is no entry, when it has more root visits, or when visits
    /// are equal and only the new one is final. Returns whether it was stored. A stored
    /// update counts as a use; a new position arriving at capacity evicts the least
    /// recently used one.
    pub fn offer(&mut self, update: AnalysisUpdate) -> bool {
        let better = match self.entries.get(&update.position) {
            None => true,
            Some((old, _)) => {
                update.root_visits > old.root_visits
                    || (update.root_visits == old.root_visits && update.is_final && !old.is_final)
            }
        };
        if better {
            if !self.entries.contains_key(&update.position) && self.entries.len() >= self.capacity {
                // O(n), at n = 1,024 by default.
                let oldest = self
                    .entries
                    .iter()
                    .min_by_key(|(_, (_, used))| *used)
                    .map(|(&key, _)| key);
                if let Some(oldest) = oldest {
                    self.entries.remove(&oldest);
                }
            }
            self.tick += 1;
            self.entries.insert(update.position, (update, self.tick));
        }
        better
    }

    /// The entry for `key`. Reading counts as a use.
    pub fn get(&mut self, key: PositionKey) -> Option<&AnalysisUpdate> {
        self.tick += 1;
        let tick = self.tick;
        self.entries.get_mut(&key).map(|(update, used)| {
            *used = tick;
            &*update
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upd(visits: u32, is_final: bool) -> AnalysisUpdate {
        upd_at(7, visits, is_final)
    }

    fn upd_at(key: u64, visits: u32, is_final: bool) -> AnalysisUpdate {
        AnalysisUpdate {
            position: PositionKey(key),
            board_size: 19,
            root_visits: visits,
            winrate: 0.5,
            score_lead: 0.0,
            is_final,
            candidates: vec![],
        }
    }

    #[test]
    fn cache_keeps_the_most_visited() {
        let mut c = AnalysisCache::new();
        assert!(c.offer(upd(300, false)));
        assert!(!c.offer(upd(200, false)));
        assert!(c.offer(upd(300, true)));
        assert!(!c.offer(upd(300, true)));
        assert_eq!(c.get(PositionKey(7)).unwrap().root_visits, 300);
        assert!(c.get(PositionKey(8)).is_none());
    }

    #[test]
    fn cache_is_bounded() {
        let mut c = AnalysisCache::with_capacity(2);
        assert!(c.offer(upd_at(1, 10, false)));
        assert!(c.offer(upd_at(2, 10, false)));
        assert!(c.get(PositionKey(1)).is_some());
        assert!(c.offer(upd_at(3, 10, false)));
        assert!(
            c.get(PositionKey(2)).is_none(),
            "the least recently used goes"
        );
        assert!(c.get(PositionKey(1)).is_some());
        assert!(c.get(PositionKey(3)).is_some());
    }

    #[test]
    fn cache_updates_do_not_evict() {
        let mut c = AnalysisCache::with_capacity(2);
        c.offer(upd_at(1, 10, false));
        c.offer(upd_at(2, 10, false));
        assert!(c.offer(upd_at(1, 20, false)));
        assert_eq!(c.get(PositionKey(1)).unwrap().root_visits, 20);
        assert!(c.get(PositionKey(2)).is_some());
    }
}
