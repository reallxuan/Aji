//! The service's side of whole-game analysis (P2 M2 design 5.3): it follows the engine's kept
//! results and job statuses, pushes the trend nodes that changed with their losses, and runs
//! the job's passes in turn.

use std::collections::{BTreeSet, HashMap};
use std::sync::MutexGuard;
use std::time::Duration;

use aji_core::PositionKey;
use aji_engine::{AnalysisUpdate, EngineEvent, JobStatus, Loss, TrendStats};
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::game::{GameSession, LineNode};
use crate::job::{JobFlow, JobOptions, JobProgress, JobState, Step, line_losses};
use crate::protocol::{AppEvent, ProtocolError, Response, TrendChange, TrendNode, TrendNodeUpdate};
use crate::service::AppContext;

/// Trend nodes and job progress go out at most this often.
pub const THROTTLE: Duration = Duration::from_millis(250);

/// The trend's line, as last sent whole, and its results since.
#[derive(Debug, Default)]
struct TrendLine {
    revision: u64,
    line: Vec<LineNode<()>>,
    stats: Vec<Option<TrendStats>>,
    /// Selected-line slots by position, including comment nodes that share their parent’s key.
    at: HashMap<PositionKey, Vec<usize>>,
}

/// What the follower keeps between events.
#[derive(Debug, Default)]
pub struct Follow {
    pub flow: JobFlow,
    trend: TrendLine,
    /// A full broadcast supersedes in-flight deltas, including clears at the same line revision.
    publication: u64,
    /// Nodes whose result or loss changed since the last push.
    dirty: BTreeSet<usize>,
    /// The latest job progress not pushed yet.
    progress: Option<JobProgress>,
}

pub(crate) fn lock(ctx: &AppContext) -> MutexGuard<'_, Follow> {
    ctx.follow.lock().unwrap_or_else(|e| e.into_inner())
}

/// The keys of the positions before nodes whose loss needs the candidate list: the node has
/// no result of its own but the position before has one.
fn fallback_keys(line: &[LineNode<()>], stats: &[Option<TrendStats>]) -> Vec<PositionKey> {
    let mut keys: Vec<PositionKey> = (1..line.len())
        .filter(|&i| line[i].mv.is_some() && stats[i].is_none() && stats[i - 1].is_some())
        .filter_map(|i| line[i - 1].key)
        .collect();
    keys.sort_unstable_by_key(|k| k.0);
    keys.dedup();
    keys
}

/// The kept results of `keys`, by key.
async fn updates_of(
    ctx: &AppContext,
    keys: Vec<PositionKey>,
) -> HashMap<PositionKey, AnalysisUpdate> {
    if keys.is_empty() {
        return HashMap::new();
    }
    let found = ctx.engine.updates(keys.clone()).await;
    keys.into_iter()
        .zip(found)
        .filter_map(|(k, u)| Some((k, u?)))
        .collect()
}

/// The kept stats of each node; `None` on an illegal one.
async fn stats_of(ctx: &AppContext, keys: &[Option<PositionKey>]) -> Vec<Option<TrendStats>> {
    // An illegal node has no position; a key no position can have keeps the order.
    let queries = keys
        .iter()
        .map(|key| key.unwrap_or(PositionKey(0)))
        .collect();
    let mut stats = ctx.engine.summaries(queries).await;
    for (slot, key) in stats.iter_mut().zip(keys) {
        if key.is_none() {
            *slot = None;
        }
    }
    stats
}

async fn losses_of(
    ctx: &AppContext,
    line: &[LineNode<()>],
    stats: &[Option<TrendStats>],
) -> Vec<Option<Loss>> {
    let before = updates_of(ctx, fallback_keys(line, stats)).await;
    line_losses(line, stats, &|k| before.get(&k).cloned())
}

/// The session's trend, which the follower then keeps current. Called with the session locked.
/// With a change reason it goes to every client, sent under the follower's lock so no
/// `trendNodes` for the new line can go out before it.
pub(crate) async fn trend_of(
    ctx: &AppContext,
    session: &GameSession,
    reason: Option<TrendChange>,
) -> (u64, Vec<TrendNode>) {
    let line = session.line();
    let keys: Vec<_> = line.iter().map(|n| n.key).collect();
    let stats = stats_of(ctx, &keys).await;
    let losses = losses_of(ctx, &line, &stats).await;
    let revision = session.line_revision;
    let nodes: Vec<TrendNode> = line
        .iter()
        .zip(&stats)
        .zip(losses)
        .map(|((node, &stats), loss)| TrendNode {
            node: node.node as u32,
            key: node.key,
            move_number: node.move_number,
            mover: node.mover,
            to_play: node.to_play,
            tryout: node.tryout,
            mv: node.mv,
            stats,
            loss,
        })
        .collect();
    let mut at: HashMap<PositionKey, Vec<usize>> = HashMap::new();
    for (i, node) in line.iter().enumerate() {
        if let Some(key) = node.key {
            at.entry(key).or_default().push(i);
        }
    }
    let mut follow = lock(ctx);
    follow.trend = TrendLine {
        revision,
        line,
        stats,
        at,
    };
    if let Some(reason) = reason {
        follow.publication += 1;
        follow.dirty.clear();
        ctx.events.emit(AppEvent::GameTrend {
            reason,
            revision,
            nodes: nodes.clone(),
        });
    }
    (revision, nodes)
}

/// A kept result: true when it changed a node of the trend's line.
pub(crate) fn stored(ctx: &AppContext, key: PositionKey, stats: TrendStats) -> bool {
    let mut follow = lock(ctx);
    let Some(indexes) = follow.trend.at.get(&key).cloned() else {
        return false;
    };
    let len = follow.trend.line.len();
    for i in indexes {
        follow.trend.stats[i] = Some(stats);
        // The node's own loss and the next node's.
        follow.dirty.insert(i);
        if i + 1 < len {
            follow.dirty.insert(i + 1);
        }
    }
    true
}

/// Pushes the pending job progress and the changed trend nodes.
pub(crate) async fn flush(ctx: &AppContext) {
    let (publication, dirty, keys) = {
        let mut follow = lock(ctx);
        if let Some(progress) = follow.progress.take() {
            ctx.events.emit(AppEvent::JobProgress { progress });
        }
        if follow.dirty.is_empty() {
            return;
        }
        let dirty: Vec<usize> = std::mem::take(&mut follow.dirty).into_iter().collect();
        let trend = &follow.trend;
        (
            follow.publication,
            dirty,
            fallback_keys(&trend.line, &trend.stats),
        )
    };
    let before = updates_of(ctx, keys).await;
    let follow = lock(ctx);
    let trend = &follow.trend;
    if follow.publication != publication {
        // A full trend went out while reading the candidate lists.
        return;
    }
    let losses = line_losses(&trend.line, &trend.stats, &|k| before.get(&k).cloned());
    let nodes = dirty
        .into_iter()
        .map(|i| TrendNodeUpdate {
            line_index: i as u32,
            stats: trend.stats[i],
            loss: losses[i],
        })
        .collect();
    ctx.events.emit(AppEvent::TrendNodes {
        revision: trend.revision,
        nodes,
    });
}

/// Whether an event left something to push at the next throttle tick. Final job states are
/// pushed at once instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Push {
    Later,
    None,
}

fn push_now(ctx: &AppContext, progress: JobProgress) {
    lock(ctx).progress = None;
    ctx.events.emit(AppEvent::JobProgress { progress });
}

/// A job status from the engine: progress to show, or the next pass to start.
pub(crate) async fn on_job(ctx: &AppContext, status: JobStatus) -> Push {
    let session = ctx.game.lock().await;
    let step = lock(ctx).flow.on_status(&status);
    match step {
        Step::Ignore => Push::None,
        Step::Progress(progress) if progress.state == JobState::Stopped => {
            push_now(ctx, progress);
            Push::None
        }
        Step::Progress(progress) => {
            lock(ctx).progress = Some(progress);
            Push::Later
        }
        Step::PassDone => {
            drop(session);
            next_pass(ctx, status.id).await;
            Push::None
        }
    }
}

/// Plans and starts the pass after plan `id`'s, from the line's results now.
async fn next_pass(ctx: &AppContext, id: u64) {
    let Some(line) = lock(ctx)
        .flow
        .line()
        .map(|line| line.iter().map(|n| n.key).collect::<Vec<_>>())
    else {
        return;
    };
    let stats = stats_of(ctx, &line).await;
    // The fill pass reads every move's candidate list.
    let mut keys: Vec<PositionKey> = line.into_iter().flatten().collect();
    keys.sort_unstable_by_key(|k| k.0);
    keys.dedup();
    let before = updates_of(ctx, keys).await;
    // Read the cache without holding up edits, then serialize the ID check and
    // engine submission with a rules change, replacement job or explicit stop.
    let _session = ctx.game.lock().await;
    let next = {
        let mut follow = lock(ctx);
        if follow.flow.plan_id() != Some(id) {
            // Stopped or replaced meanwhile.
            return;
        }
        follow.flow.next_pass(&stats, &|k| before.get(&k).cloned())
    };
    match next {
        Ok(plan) => {
            if let Err(e) = ctx.engine.run_job(plan).await {
                eprintln!("aji: the engine did not take the job's next pass: {e}");
                let stopped = lock(ctx).flow.stop();
                if let Some(progress) = stopped {
                    push_now(ctx, progress);
                }
            }
        }
        Err(done) => push_now(ctx, done),
    }
}

/// Starts a job on the selected line or all kept branches, replacing a running one.
pub(crate) async fn job_start(
    ctx: &AppContext,
    options: JobOptions,
) -> Result<Response, ProtocolError> {
    let session = ctx.game.lock().await;
    start_on(ctx, &session, options).await?;
    Ok(Response::Ok)
}

/// `job_start` with the session already locked.
pub(crate) async fn start_on(
    ctx: &AppContext,
    session: &GameSession,
    mut options: JobOptions,
) -> Result<(), ProtocolError> {
    options.visits = options.visits.max(1);
    options.boost.visits = options.boost.visits.max(1);
    let nodes = session.job_nodes(options.scope);
    let current = session.position().map(|position| position.key());
    let plan = lock(ctx).flow.start(nodes, current, options);
    if let Err(e) = ctx.engine.run_job(plan).await {
        lock(ctx).flow.stop();
        return Err(e.into());
    }
    Ok(())
}

/// Stops the running job, if any, and tells every client.
pub(crate) async fn stop_job(ctx: &AppContext) {
    let stopped = lock(ctx).flow.stop();
    if let Some(progress) = stopped {
        ctx.engine.stop_job().await;
        push_now(ctx, progress);
    }
}

/// Follows the engine's `Stored` and `Job` events until the engine goes away, pushing at most
/// every [`THROTTLE`].
pub async fn follow_engine(ctx: AppContext, mut events: mpsc::UnboundedReceiver<EngineEvent>) {
    let mut due: Option<Instant> = None;
    loop {
        let event = match due {
            Some(at) => match tokio::time::timeout_at(at, events.recv()).await {
                Ok(event) => event,
                Err(_) => {
                    due = None;
                    flush(&ctx).await;
                    continue;
                }
            },
            None => events.recv().await,
        };
        let Some(event) = event else { break };
        let push = match event {
            EngineEvent::Stored { key, .. } => {
                // A queued notification can precede a cache clear or a newer result.
                // Only the current cache value belongs on the currently published line.
                let _session = ctx.game.lock().await;
                if !lock(&ctx).trend.at.contains_key(&key) {
                    continue;
                }
                let summary = ctx
                    .engine
                    .summaries(vec![key])
                    .await
                    .into_iter()
                    .next()
                    .flatten();
                if summary.is_some_and(|stats| stored(&ctx, key, stats)) {
                    Push::Later
                } else {
                    Push::None
                }
            }
            EngineEvent::Job(status) => on_job(&ctx, status).await,
            _ => Push::None,
        };
        if push == Push::Later {
            due.get_or_insert_with(|| Instant::now() + THROTTLE);
        }
    }
}

#[cfg(test)]
pub(crate) fn trend_length(ctx: &AppContext) -> usize {
    lock(ctx).trend.line.len()
}
