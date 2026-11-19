//! An in-memory cache keeping the most-visited analysis per position.

use std::collections::HashMap;

use aji_core::PositionKey;

use crate::update::AnalysisUpdate;

#[derive(Debug, Default)]
pub struct AnalysisCache {
    entries: HashMap<PositionKey, AnalysisUpdate>,
}

impl AnalysisCache {
    pub fn new() -> AnalysisCache {
        AnalysisCache::default()
    }

    /// Stores `update` when there is no entry, when it has more root visits, or when visits
    /// are equal and only the new one is final. Returns whether it was stored.
    pub fn offer(&mut self, update: AnalysisUpdate) -> bool {
        let better = match self.entries.get(&update.position) {
            None => true,
            Some(old) => {
                update.root_visits > old.root_visits
                    || (update.root_visits == old.root_visits && update.is_final && !old.is_final)
            }
        };
        if better {
            self.entries.insert(update.position, update);
        }
        better
    }

    pub fn get(&self, key: PositionKey) -> Option<&AnalysisUpdate> {
        self.entries.get(&key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upd(visits: u32, is_final: bool) -> AnalysisUpdate {
        AnalysisUpdate {
            position: PositionKey(7),
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
}
