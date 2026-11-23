//! The whole-game job's queue (P2 M2 design 5.3): which positions are left, which are being
//! searched, and how many are done. The engine actor owns one and decides when to submit.

use std::collections::VecDeque;
use std::time::Duration;

use aji_core::{Position, PositionKey};

/// Job queries report this often, for the watchdog only: nothing shows these reports.
pub const JOB_REPORT_EVERY: Duration = Duration::from_secs(1);

/// One position to search to `visits`. `line_index` is its node on the main line.
#[derive(Debug, Clone, PartialEq)]
pub struct JobItem {
    pub position: Position,
    pub line_index: u32,
    pub visits: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JobPlan {
    /// Echoed in every [`JobStatus`], so a caller can tell its job's statuses from a replaced
    /// one's.
    pub id: u64,
    pub items: Vec<JobItem>,
    /// The job's visits per position: while it runs, the board's query stops at this, even
    /// with no board limit, so the job is not starved.
    pub budget: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobRun {
    Running,
    /// The board's query for the current position runs first.
    Waiting,
    Paused,
    Done,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobStatus {
    /// The plan's id.
    pub id: u64,
    pub run: JobRun,
    pub done: u32,
    pub total: u32,
    /// Of `done`, those found already in the cache and not searched: the rate leaves them out.
    pub skipped: u32,
    /// The line index being searched.
    pub working: Option<u32>,
    /// The line indexes still to search, in order.
    pub queued: Vec<u32>,
}

/// A job query in flight.
#[derive(Debug, Clone)]
pub(crate) struct Flight {
    pub id: String,
    pub item: JobItem,
}

#[derive(Debug, Default)]
pub(crate) struct JobQueue {
    id: u64,
    pending: VecDeque<JobItem>,
    /// In submission order: the first is the one KataGo is searching.
    in_flight: Vec<Flight>,
    done: u32,
    skipped: u32,
    total: u32,
}

impl JobQueue {
    pub fn new(plan: &JobPlan) -> JobQueue {
        JobQueue {
            id: plan.id,
            pending: plan.items.iter().cloned().collect(),
            in_flight: Vec::new(),
            done: 0,
            skipped: 0,
            total: plan.items.len() as u32,
        }
    }

    /// The next item to search. Items whose `cached` visits already reach their target are
    /// counted done and skipped. An item for `defer` (the position the board is searching) goes
    /// to the back, unless nothing else is left.
    pub fn next(
        &mut self,
        cached: impl Fn(PositionKey) -> u32,
        defer: Option<PositionKey>,
    ) -> Option<JobItem> {
        let mut deferred = 0;
        while let Some(item) = self.pending.pop_front() {
            let key = item.position.key();
            if cached(key) >= item.visits {
                self.done += 1;
                self.skipped += 1;
                continue;
            }
            if defer == Some(key) && deferred < self.pending.len() {
                deferred += 1;
                self.pending.push_back(item);
                continue;
            }
            return Some(item);
        }
        None
    }

    pub fn started(&mut self, id: String, item: JobItem) {
        self.in_flight.push(Flight { id, item });
    }

    /// A query ended. Counts its item done only if it was in flight: a terminated query's
    /// late final is not.
    pub fn finished(&mut self, id: &str) -> bool {
        let Some(at) = self.in_flight.iter().position(|f| f.id == id) else {
            return false;
        };
        self.in_flight.remove(at);
        self.done += 1;
        true
    }

    /// Takes every query out of flight and puts their items back at the front, in order.
    /// Returns the ids to terminate.
    pub fn requeue_all(&mut self) -> Vec<String> {
        let flights = std::mem::take(&mut self.in_flight);
        let ids = flights.iter().map(|f| f.id.clone()).collect();
        for flight in flights.into_iter().rev() {
            self.pending.push_front(flight.item);
        }
        ids
    }

    #[cfg(test)]
    pub fn in_flight(&self) -> &[Flight] {
        &self.in_flight
    }

    pub fn is_done(&self) -> bool {
        self.pending.is_empty() && self.in_flight.is_empty()
    }

    pub fn status(&self, run: JobRun) -> JobStatus {
        JobStatus {
            id: self.id,
            run,
            done: self.done,
            total: self.total,
            skipped: self.skipped,
            working: self.in_flight.first().map(|f| f.item.line_index),
            queued: self
                .in_flight
                .iter()
                .skip(1)
                .map(|f| &f.item)
                .chain(&self.pending)
                .map(|i| i.line_index)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aji_core::{BoardSize, Color, Komi, Move, Point, Rules};

    fn item(n: u8, visits: u32) -> JobItem {
        let mut position =
            Position::empty(BoardSize::NINETEEN, Rules::Chinese, Komi::new(7.5).unwrap());
        position.moves = (0..n)
            .map(|i| {
                (
                    if i % 2 == 0 {
                        Color::Black
                    } else {
                        Color::White
                    },
                    Move::Play(Point { x: i, y: 0 }),
                )
            })
            .collect();
        JobItem {
            position,
            line_index: u32::from(n),
            visits,
        }
    }

    fn queue(n: u8) -> JobQueue {
        JobQueue::new(&JobPlan {
            id: 1,
            items: (0..n).map(|i| item(i, 500)).collect(),
            budget: 500,
        })
    }

    #[test]
    fn items_at_target_are_skipped_and_counted() {
        let mut q = queue(4);
        // Item 1 has a stored result (imported or not) at the target, item 2 one below it.
        let k1 = item(1, 500).position.key();
        let k2 = item(2, 500).position.key();
        let cached = |k: PositionKey| {
            if k == k1 {
                500
            } else if k == k2 {
                499
            } else {
                0
            }
        };
        assert_eq!(q.next(cached, None).map(|i| i.line_index), Some(0));
        assert_eq!(q.next(cached, None).map(|i| i.line_index), Some(2));
        assert_eq!(q.status(JobRun::Running).done, 1);
        assert_eq!(q.status(JobRun::Running).total, 4);
        // The skip is reported, so the estimate leaves it out of the rate.
        assert_eq!(q.status(JobRun::Running).skipped, 1);
        q.started("q0".into(), item(0, 500));
        q.finished("q0");
        assert_eq!(q.status(JobRun::Running).skipped, 1);
    }

    #[test]
    fn the_boards_position_waits_its_turn() {
        let mut q = queue(3);
        let k0 = item(0, 500).position.key();
        assert_eq!(q.next(|_| 0, Some(k0)).map(|i| i.line_index), Some(1));
        assert_eq!(q.next(|_| 0, Some(k0)).map(|i| i.line_index), Some(2));
        // Nothing else left: it is searched by the job after all.
        assert_eq!(q.next(|_| 0, Some(k0)).map(|i| i.line_index), Some(0));
    }

    #[test]
    fn requeue_puts_terminated_items_first() {
        let mut q = queue(4);
        for id in ["a", "b"] {
            let next = q.next(|_| 0, None).unwrap();
            q.started(id.into(), next);
        }
        assert_eq!(q.status(JobRun::Running).working, Some(0));
        assert_eq!(q.requeue_all(), vec!["a".to_string(), "b".to_string()]);
        assert!(q.in_flight().is_empty());
        assert_eq!(q.status(JobRun::Running).queued, vec![0, 1, 2, 3]);
        assert_eq!(q.next(|_| 0, None).map(|i| i.line_index), Some(0));
    }

    #[test]
    fn done_counts_once_per_item() {
        let mut q = queue(2);
        let first = q.next(|_| 0, None).unwrap();
        q.started("a".into(), first);
        q.requeue_all();
        // The terminated query's late final.
        assert!(!q.finished("a"));
        assert_eq!(q.status(JobRun::Running).done, 0);
        let again = q.next(|_| 0, None).unwrap();
        q.started("c".into(), again);
        assert!(q.finished("c"));
        assert!(!q.finished("c"));
        assert_eq!(q.status(JobRun::Running).done, 1);
        let last = q.next(|_| 0, None).unwrap();
        q.started("d".into(), last);
        assert!(q.finished("d"));
        assert!(q.is_done());
        assert_eq!(q.status(JobRun::Done).done, 2);
    }
}
