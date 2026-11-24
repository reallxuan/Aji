//! Whole-game analysis as the service plans it (P2 M2 design 5.3): which positions each pass
//! searches, the moves' losses, and the passes in order (first, fill for one side, boost,
//! done). Pure: the service feeds it the engine's statuses and results.

use std::collections::HashSet;
use std::time::Instant;

use aji_core::{Color, PositionKey};
use aji_engine::{
    AnalysisUpdate, JobItem, JobPlan, JobRun, JobStatus, Loss, TrendStats, loss_from_candidates,
    move_loss,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::game::LineNode;

/// Which moves a job covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum JobRange {
    Whole,
    /// Moves `from` to `to`, both included: the positions from before `from` to after `to`.
    Moves {
        from: u32,
        to: u32,
    },
}

/// Whose moves a job covers: one side searches only the positions that side moves in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum JobSide {
    Both,
    Black,
    White,
}

/// The deeper pass over big swings.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BoostOptions {
    pub on: bool,
    /// Percentage points of win rate.
    pub threshold: f64,
    pub visits: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobOptions {
    pub range: JobRange,
    pub side: JobSide,
    /// Visits per position.
    pub visits: u32,
    pub boost: BoostOptions,
}

impl JobOptions {
    /// Options a job can run with: some visits, a forward range of moves, a positive threshold.
    pub fn is_valid(&self) -> bool {
        let range = match self.range {
            JobRange::Whole => true,
            JobRange::Moves { from, to } => 1 <= from && from <= to,
        };
        range
            && self.visits > 0
            && self.boost.visits > 0
            && self.boost.threshold.is_finite()
            && self.boost.threshold > 0.0
    }
}

impl Default for JobOptions {
    fn default() -> Self {
        JobOptions {
            range: JobRange::Whole,
            side: JobSide::Both,
            visits: 500,
            boost: BoostOptions {
                on: true,
                threshold: 10.0,
                visits: 3000,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum JobState {
    Running,
    /// The current position is searched first.
    Waiting,
    Paused,
    Boosting,
    Done,
    Stopped,
}

/// What the interface shows of a job.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct JobProgress {
    pub state: JobState,
    pub done: u32,
    pub total: u32,
    pub boost_done: u32,
    pub boost_total: u32,
    /// The main-line index being searched.
    pub working: Option<u32>,
    /// The main-line indexes still to search.
    pub queued: Vec<u32>,
    pub eta_seconds: Option<u32>,
}

/// The side to move in a node's position; `None` on an illegal node.
pub(crate) fn to_move(node: &LineNode) -> Option<Color> {
    node.position.as_ref().map(|position| position.to_move())
}

fn side_is(side: JobSide, color: Color) -> bool {
    match side {
        JobSide::Both => true,
        JobSide::Black => color == Color::Black,
        JobSide::White => color == Color::White,
    }
}

/// The node's position lies between before move `from` and after move `to`.
fn position_in_range(node: &LineNode, range: JobRange) -> bool {
    match range {
        JobRange::Whole => true,
        JobRange::Moves { from, to } => node.move_number + 1 >= from && node.move_number <= to,
    }
}

/// The node's move is one of moves `from` to `to`.
fn move_in_range(node: &LineNode, range: JobRange) -> bool {
    match range {
        JobRange::Whole => true,
        JobRange::Moves { from, to } => (from..=to).contains(&node.move_number),
    }
}

/// The first pass: every distinct position in range (for one side, those it moves in), the
/// current position first, then in line order. Illegal nodes are skipped.
pub fn plan_first_pass(line: &[LineNode], options: &JobOptions, current: usize) -> Vec<JobItem> {
    let mut seen = HashSet::new();
    let mut items: Vec<JobItem> = line
        .iter()
        .enumerate()
        .filter(|(_, node)| position_in_range(node, options.range))
        .filter(|(_, node)| to_move(node).is_some_and(|c| side_is(options.side, c)))
        .filter_map(|(i, node)| {
            let position = node.position.clone()?;
            seen.insert(position.key()).then_some(JobItem {
                position,
                line_index: i as u32,
                visits: options.visits,
            })
        })
        .collect();
    if let Some(key) = line.get(current).and_then(|n| n.key)
        && let Some(at) = items.iter().position(|i| i.position.key() == key)
    {
        let item = items.remove(at);
        items.insert(0, item);
    }
    items
}

/// The fill pass, for one side: the positions after that side's moves that the position before
/// did not list (design 5.3).
pub fn plan_fill_pass(
    line: &[LineNode],
    options: &JobOptions,
    before: &dyn Fn(PositionKey) -> Option<AnalysisUpdate>,
) -> Vec<JobItem> {
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for (i, pair) in line.windows(2).enumerate() {
        let (prev, node) = (&pair[0], &pair[1]);
        let (Some(mover), Some(mv), Some(position)) = (node.mover, node.mv, &node.position) else {
            continue;
        };
        if !side_is(options.side, mover) || !move_in_range(node, options.range) {
            continue;
        }
        let listed = prev
            .key
            .and_then(before)
            .is_some_and(|u| u.candidates.iter().any(|c| c.mv == mv));
        if !listed && seen.insert(position.key()) {
            items.push(JobItem {
                position: position.clone(),
                line_index: i as u32 + 1,
                visits: options.visits,
            });
        }
    }
    items
}

/// The boost pass: both positions of every move in range (and side) whose win-rate loss is over
/// the threshold either way, at the boost's visits.
pub fn plan_boost(
    line: &[LineNode],
    losses: &[Option<Loss>],
    options: &JobOptions,
) -> Vec<JobItem> {
    let mut wanted = Vec::new();
    for (i, node) in line.iter().enumerate().skip(1) {
        let big = losses
            .get(i)
            .copied()
            .flatten()
            .is_some_and(|l| l.winrate.abs() >= options.boost.threshold);
        if big
            && node.mover.is_some_and(|c| side_is(options.side, c))
            && move_in_range(node, options.range)
        {
            wanted.extend([i - 1, i]);
        }
    }
    wanted.sort_unstable();
    wanted.dedup();
    let mut seen = HashSet::new();
    wanted
        .into_iter()
        .filter_map(|i| {
            let position = line[i].position.clone()?;
            seen.insert(position.key()).then_some(JobItem {
                position,
                line_index: i as u32,
                visits: options.boost.visits,
            })
        })
        .collect()
}

/// Each node's move loss (design 5.1): from the two positions' results, else from the position
/// before's candidate list. A node without a move has none.
pub fn line_losses(
    line: &[LineNode],
    stats: &[Option<TrendStats>],
    before: &dyn Fn(PositionKey) -> Option<AnalysisUpdate>,
) -> Vec<Option<Loss>> {
    let stat = |i: usize| stats.get(i).copied().flatten();
    (0..line.len())
        .map(|i| {
            let node = &line[i];
            let (Some(mover), Some(mv)) = (node.mover, node.mv) else {
                return None;
            };
            let prev = i.checked_sub(1)?;
            if let (Some(b), Some(a)) = (stat(prev), stat(i)) {
                return Some(move_loss(&b, &a, mover));
            }
            let update = line[prev].key.and_then(before)?;
            loss_from_candidates(&update, mv, mover)
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    First,
    Fill,
    Boost,
}

#[derive(Debug)]
struct Run {
    id: u64,
    phase: Phase,
    options: JobOptions,
    line: Vec<LineNode>,
    first_total: u32,
    fill_total: u32,
    /// When the current pass started, for the time estimate.
    started: Instant,
    /// The latest progress shown.
    progress: JobProgress,
}

impl Run {
    /// Positions of the first and fill passes.
    fn main_total(&self) -> u32 {
        self.first_total + self.fill_total
    }
}

/// What a status means for the service.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// Show this.
    Progress(JobProgress),
    /// The pass ended: call `next_pass` with fresh results.
    PassDone,
    /// Another job's status.
    Ignore,
}

/// The passes of the running job.
#[derive(Debug, Default)]
pub struct JobFlow {
    next_id: u64,
    run: Option<Run>,
}

impl JobFlow {
    /// Starts a job on `line` with the user at `current`; returns the first pass's plan.
    pub fn start(&mut self, line: Vec<LineNode>, current: usize, options: JobOptions) -> JobPlan {
        let items = plan_first_pass(&line, &options, current);
        let total = items.len() as u32;
        let id = self.new_id();
        self.run = Some(Run {
            id,
            phase: Phase::First,
            options,
            line,
            first_total: total,
            fill_total: 0,
            started: Instant::now(),
            progress: JobProgress {
                state: JobState::Running,
                done: 0,
                total,
                boost_done: 0,
                boost_total: 0,
                working: None,
                queued: Vec::new(),
                eta_seconds: None,
            },
        });
        JobPlan {
            id,
            items,
            budget: options.visits,
        }
    }

    fn new_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    /// The running plan's id.
    pub fn plan_id(&self) -> Option<u64> {
        self.run.as_ref().map(|r| r.id)
    }

    pub fn is_running(&self) -> bool {
        self.run.is_some()
    }

    /// The running job's options.
    pub fn options(&self) -> Option<JobOptions> {
        self.run.as_ref().map(|r| r.options)
    }

    /// The main line the job runs on.
    pub fn line(&self) -> Option<&[LineNode]> {
        self.run.as_ref().map(|r| r.line.as_slice())
    }

    pub fn on_status(&mut self, status: &JobStatus) -> Step {
        let Some(run) = self.run.as_mut().filter(|r| r.id == status.id) else {
            return Step::Ignore;
        };
        if status.run == JobRun::Done {
            return Step::PassDone;
        }
        let p = &mut run.progress;
        match run.phase {
            Phase::First => p.done = status.done,
            Phase::Fill => p.done = run.first_total + status.done,
            Phase::Boost => p.boost_done = status.done,
        }
        p.working = status.working;
        p.queued = status.queued.clone();
        p.state = match (status.run, run.phase) {
            (JobRun::Waiting, _) => JobState::Waiting,
            (JobRun::Paused, _) => JobState::Paused,
            (JobRun::Stopped, _) => JobState::Stopped,
            (_, Phase::Boost) => JobState::Boosting,
            _ => JobState::Running,
        };
        // The estimate is for the current pass only.
        let elapsed = run.started.elapsed().as_secs_f64();
        // Positions found in the cache count done at once; the rate is the searched ones'.
        let searched = status.done.saturating_sub(status.skipped);
        p.eta_seconds = (searched > 0 && status.run == JobRun::Running).then(|| {
            let left = status.total.saturating_sub(status.done);
            (elapsed / f64::from(searched) * f64::from(left)).round() as u32
        });
        let progress = p.clone();
        if status.run == JobRun::Stopped {
            self.run = None;
        }
        Step::Progress(progress)
    }

    /// The pass after the one that ended, given the line's results now: `Ok` a plan to run, or
    /// `Err` the done progress.
    pub fn next_pass(
        &mut self,
        stats: &[Option<TrendStats>],
        before: &dyn Fn(PositionKey) -> Option<AnalysisUpdate>,
    ) -> Result<JobPlan, JobProgress> {
        let id = self.new_id();
        let Some(run) = self.run.as_mut() else {
            return Err(JobProgress {
                state: JobState::Done,
                done: 0,
                total: 0,
                boost_done: 0,
                boost_total: 0,
                working: None,
                queued: Vec::new(),
                eta_seconds: None,
            });
        };
        run.progress.working = None;
        run.progress.queued.clear();
        run.progress.eta_seconds = None;
        if run.phase == Phase::First {
            run.progress.done = run.first_total;
            if run.options.side != JobSide::Both {
                let items = plan_fill_pass(&run.line, &run.options, before);
                if !items.is_empty() {
                    run.fill_total = items.len() as u32;
                    run.progress.total = run.main_total();
                    return Ok(run.enter(Phase::Fill, id, items, run.options.visits));
                }
            }
        }
        if run.phase != Phase::Boost {
            run.progress.done = run.main_total();
            run.progress.total = run.main_total();
            if run.options.boost.on {
                let losses = line_losses(&run.line, stats, before);
                let items = plan_boost(&run.line, &losses, &run.options);
                if !items.is_empty() {
                    run.progress.boost_total = items.len() as u32;
                    return Ok(run.enter(Phase::Boost, id, items, run.options.boost.visits));
                }
            }
        }
        let mut done = run.progress.clone();
        done.state = JobState::Done;
        done.boost_done = done.boost_total;
        self.run = None;
        Err(done)
    }

    /// Stops the job; the stopped progress when one was running.
    pub fn stop(&mut self) -> Option<JobProgress> {
        let mut p = self.run.take()?.progress;
        p.state = JobState::Stopped;
        p.working = None;
        p.queued.clear();
        p.eta_seconds = None;
        Some(p)
    }
}

impl Run {
    fn enter(&mut self, phase: Phase, id: u64, items: Vec<JobItem>, budget: u32) -> JobPlan {
        self.phase = phase;
        self.id = id;
        self.started = Instant::now();
        self.progress.state = if phase == Phase::Boost {
            JobState::Boosting
        } else {
            JobState::Running
        };
        JobPlan { id, items, budget }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aji_core::game::AnalysisRules;
    use aji_core::{Move, Point};
    use aji_engine::Candidate;

    use crate::game::GameSession;

    fn line(sgf: &str) -> Vec<LineNode> {
        GameSession::open("t.sgf", sgf.as_bytes(), AnalysisRules::Chinese)
            .unwrap()
            .line()
    }

    /// Eight moves on 9×9.
    const GAME: &str = "(;GM[1]FF[4]SZ[9]KM[7.5];B[cc];W[gg];B[cg];W[gc];B[ee];W[dg];B[fc];W[ge])";

    fn indexes(items: &[JobItem]) -> Vec<u32> {
        items.iter().map(|i| i.line_index).collect()
    }

    fn stats(winrate: f64) -> Option<TrendStats> {
        Some(TrendStats {
            winrate,
            score_lead: 0.0,
            visits: 500,
        })
    }

    /// A result listing `listed` in order, each worse for White (Black's win rate up 10 points
    /// and score lead up 2 per place).
    fn update(key: PositionKey, listed: &[Move]) -> AnalysisUpdate {
        AnalysisUpdate {
            position: key,
            board_size: 9,
            root_visits: 500,
            winrate: 0.5,
            score_lead: 0.0,
            is_final: true,
            candidates: listed
                .iter()
                .enumerate()
                .map(|(i, &mv)| Candidate {
                    mv,
                    order: i as u32,
                    visits: 100,
                    winrate: 0.5 + 0.1 * i as f64,
                    score_lead: 2.0 * i as f64,
                    prior: 0.1,
                    pv: vec![mv],
                })
                .collect(),
            previous_visits: 0,
            ownership: None,
            next: None,
        }
    }

    fn at(x: u8, y: u8) -> Move {
        Move::Play(Point { x, y })
    }

    #[test]
    fn whole_range_plans_every_distinct_position_current_first() {
        let l = line(GAME);
        let items = plan_first_pass(&l, &JobOptions::default(), 5);
        assert_eq!(indexes(&items), vec![5, 0, 1, 2, 3, 4, 6, 7, 8]);
        assert!(items.iter().all(|i| i.visits == 500));
    }

    #[test]
    fn moves_range_covers_before_x_to_after_y() {
        let l = line(GAME);
        let options = JobOptions {
            range: JobRange::Moves { from: 3, to: 5 },
            ..JobOptions::default()
        };
        // Before move 3 is node 2; after move 5 is node 5.
        assert_eq!(indexes(&plan_first_pass(&l, &options, 0)), vec![2, 3, 4, 5]);
    }

    #[test]
    fn one_side_plans_half_the_positions() {
        let l = line(GAME);
        let black = JobOptions {
            side: JobSide::Black,
            ..JobOptions::default()
        };
        assert_eq!(
            indexes(&plan_first_pass(&l, &black, 0)),
            vec![0, 2, 4, 6, 8]
        );
        let white = JobOptions {
            side: JobSide::White,
            ..JobOptions::default()
        };
        assert_eq!(indexes(&plan_first_pass(&l, &white, 0)), vec![1, 3, 5, 7]);
    }

    #[test]
    fn fill_pass_adds_after_positions_of_unlisted_moves_only() {
        let l = line(GAME);
        let black = JobOptions {
            side: JobSide::Black,
            ..JobOptions::default()
        };
        // Black's first move (C7 = cc) was listed; the second (C3 = cg) was not.
        let keys: Vec<_> = l.iter().map(|n| n.key.unwrap()).collect();
        let before = |k: PositionKey| {
            if k == keys[0] {
                Some(update(k, &[at(2, 2)]))
            } else if k == keys[2] {
                Some(update(k, &[at(4, 4)]))
            } else {
                Some(update(k, &[]))
            }
        };
        let items = plan_fill_pass(&l, &black, &before);
        // Node 3 follows Black's unlisted C3; nodes 5 and 7 follow moves no list had.
        assert_eq!(indexes(&items), vec![3, 5, 7]);
    }

    #[test]
    fn boost_takes_both_positions_of_big_swings_in_range() {
        let l = line(GAME);
        let mut losses = vec![None; l.len()];
        losses[3] = Some(Loss {
            winrate: 12.0,
            score: 3.0,
        });
        losses[6] = Some(Loss {
            winrate: -15.0,
            score: -4.0,
        });
        losses[7] = Some(Loss {
            winrate: 9.9,
            score: 2.0,
        });
        let items = plan_boost(&l, &losses, &JobOptions::default());
        assert_eq!(indexes(&items), vec![2, 3, 5, 6]);
        assert!(items.iter().all(|i| i.visits == 3000));
        let narrow = JobOptions {
            range: JobRange::Moves { from: 1, to: 4 },
            ..JobOptions::default()
        };
        assert_eq!(indexes(&plan_boost(&l, &losses, &narrow)), vec![2, 3]);
    }

    #[test]
    fn plan_skips_illegal_and_shares_comment_positions() {
        // Node 2 is a comment on the same position as node 1; node 3 plays on an occupied point.
        let l = line("(;GM[1]FF[4]SZ[9];B[cc];C[a comment];W[cc];B[dd])");
        assert_eq!(l[2].key, l[1].key);
        assert_eq!(l[3].key, None);
        let items = plan_first_pass(&l, &JobOptions::default(), 2);
        // The current comment node's position is node 1's, so node 1 goes first.
        assert_eq!(indexes(&items)[0], 1);
        assert!(!indexes(&items).contains(&2));
        assert!(!indexes(&items).contains(&3));
    }

    #[test]
    fn line_losses_fall_back_to_candidates() {
        let l = line(GAME);
        let mut s = vec![stats(0.5); l.len()];
        s[2] = None;
        let keys: Vec<_> = l.iter().map(|n| n.key.unwrap()).collect();
        let before = |k: PositionKey| (k == keys[1]).then(|| update(k, &[at(2, 6), at(6, 6)]));
        let losses = line_losses(&l, &s, &before);
        assert_eq!(losses[0], None);
        assert_eq!(
            losses[1],
            Some(Loss {
                winrate: 0.0,
                score: 0.0
            })
        );
        // W G3 (gg) is the second candidate of the position before: 10 points worse for White.
        let fallback = losses[2].unwrap();
        assert!((fallback.winrate - 10.0).abs() < 1e-9 && (fallback.score - 2.0).abs() < 1e-9);
        // The move after has no position before with a result.
        assert_eq!(losses[3], None);
    }

    #[test]
    fn passes_have_losses_and_moveless_nodes_do_not() {
        let l = line("(;GM[1]FF[4]SZ[9];B[cc];W[];C[note];B[dd])");
        let s = vec![stats(0.6), stats(0.55), stats(0.5), stats(0.5), stats(0.5)];
        let losses = line_losses(&l, &s, &|_| None);
        assert!(losses[2].is_some(), "a pass is a move");
        assert_eq!(losses[3], None, "a comment node has no move");
    }

    fn status(id: u64, run: JobRun, done: u32, total: u32) -> JobStatus {
        JobStatus {
            id,
            run,
            done,
            total,
            skipped: 0,
            working: None,
            queued: Vec::new(),
        }
    }

    #[test]
    fn the_estimate_counts_only_searched_positions() {
        // Final review #4: a job resumed over a half-cached game skips 126 positions at once;
        // its rate comes from the one it has searched, not from all 127 counted done.
        let mut flow = JobFlow::default();
        let first = flow.start(line(GAME), 0, JobOptions::default());
        std::thread::sleep(std::time::Duration::from_millis(50));
        let resumed = JobStatus {
            skipped: 126,
            ..status(first.id, JobRun::Running, 127, 248)
        };
        let Step::Progress(p) = flow.on_status(&resumed) else {
            panic!()
        };
        // At least 50 ms a search, 121 left: some seconds, not none.
        assert!(p.eta_seconds.is_some_and(|s| s >= 5), "{:?}", p.eta_seconds);
        // Nothing searched yet: no rate to go by.
        let none_searched = JobStatus {
            skipped: 126,
            ..status(first.id, JobRun::Running, 126, 248)
        };
        let Step::Progress(p) = flow.on_status(&none_searched) else {
            panic!()
        };
        assert_eq!(p.eta_seconds, None);
    }

    #[test]
    fn job_flow_runs_first_then_boost_then_done() {
        let l = line(GAME);
        let mut flow = JobFlow::default();
        let first = flow.start(l.clone(), 0, JobOptions::default());
        assert_eq!((first.items.len(), first.budget), (9, 500));
        assert_eq!(
            flow.on_status(&status(first.id + 7, JobRun::Done, 9, 9)),
            Step::Ignore
        );
        let Step::Progress(p) = flow.on_status(&status(first.id, JobRun::Waiting, 0, 9)) else {
            panic!()
        };
        assert_eq!((p.state, p.done, p.total), (JobState::Waiting, 0, 9));
        assert_eq!(
            flow.on_status(&status(first.id, JobRun::Done, 9, 9)),
            Step::PassDone
        );
        // One big swing, at node 4: the win rate stays where it went.
        let mut s = vec![stats(0.5); l.len()];
        for x in &mut s[4..] {
            *x = stats(0.65);
        }
        let boost = flow.next_pass(&s, &|_| None).unwrap();
        assert_eq!((indexes(&boost.items), boost.budget), (vec![3, 4], 3000));
        assert_ne!(boost.id, first.id);
        let Step::Progress(p) = flow.on_status(&status(boost.id, JobRun::Running, 1, 2)) else {
            panic!()
        };
        assert_eq!(
            (p.state, p.done, p.total, p.boost_done, p.boost_total),
            (JobState::Boosting, 9, 9, 1, 2)
        );
        assert_eq!(
            flow.on_status(&status(boost.id, JobRun::Done, 2, 2)),
            Step::PassDone
        );
        let done = flow.next_pass(&s, &|_| None).unwrap_err();
        assert_eq!(
            (done.state, done.boost_done, done.boost_total),
            (JobState::Done, 2, 2)
        );
        assert!(!flow.is_running());
    }

    #[test]
    fn job_flow_fills_one_side_and_skips_an_empty_boost() {
        let l = line(GAME);
        let mut flow = JobFlow::default();
        let options = JobOptions {
            side: JobSide::White,
            ..JobOptions::default()
        };
        let first = flow.start(l.clone(), 0, options);
        assert_eq!(indexes(&first.items), vec![1, 3, 5, 7]);
        assert_eq!(
            flow.on_status(&status(first.id, JobRun::Done, 4, 4)),
            Step::PassDone
        );
        let fill = flow
            .next_pass(&vec![stats(0.5); l.len()], &|k| Some(update(k, &[])))
            .unwrap();
        assert_eq!(indexes(&fill.items), vec![2, 4, 6, 8]);
        let Step::Progress(p) = flow.on_status(&status(fill.id, JobRun::Running, 1, 4)) else {
            panic!()
        };
        assert_eq!((p.done, p.total), (5, 8));
        assert_eq!(
            flow.on_status(&status(fill.id, JobRun::Done, 4, 4)),
            Step::PassDone
        );
        let done = flow
            .next_pass(&vec![stats(0.5); l.len()], &|_| None)
            .unwrap_err();
        assert_eq!((done.state, done.done, done.total), (JobState::Done, 8, 8));
    }

    #[test]
    fn stopping_or_an_engine_stop_ends_the_flow() {
        let l = line(GAME);
        let mut flow = JobFlow::default();
        assert_eq!(flow.stop(), None);
        flow.start(l.clone(), 0, JobOptions::default());
        assert_eq!(flow.stop().map(|p| p.state), Some(JobState::Stopped));
        assert!(!flow.is_running());
        let plan = flow.start(l, 0, JobOptions::default());
        let Step::Progress(p) = flow.on_status(&status(plan.id, JobRun::Stopped, 3, 9)) else {
            panic!()
        };
        assert_eq!(p.state, JobState::Stopped);
        assert!(!flow.is_running());
    }
}
