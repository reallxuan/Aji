import { createStore, useStore } from 'zustand';
import type { ActionContext } from '../game/actions';
import { applyEdit } from '../game/editActions';
import { useGameStore } from '../game/gameStore';
import { useTreeStore } from '../game/treeStore';
import { scoringInProgress } from '../scoring/scoringStore';
import type { Transport } from '../transport/transport';

type Write =
  | { text: string; status: 'pending'; done: Promise<boolean> }
  | { text: string; status: 'failed'; retry: () => Promise<boolean> };

function newQueue(game: number | undefined) {
  return {
    game,
    stopWatching: null as (() => void) | null,
    writes: createStore(() => new Map<number, Write>()),
    editors: new Set<() => void>(),
  };
}
type Queue = ReturnType<typeof newQueue>;
const queues = new WeakMap<Transport, Queue>();
function queueFor(transport: Transport) {
  const game = useGameStore.getState().snapshot?.gameRevision;
  let queue = queues.get(transport);
  if (!queue || queue.game !== game) {
    queue = newQueue(game);
    queues.set(transport, queue);
  }
  return queue;
}

export function usePendingComment(transport: Transport, node: number) {
  return useStore(queueFor(transport).writes, (writes) => writes.get(node));
}

/** A retained draft belongs to an attached SGF node. An undo can reattach its ID, so
 * forget a detached draft as soon as a matching snapshot and tree confirm removal. */
function watchFailedTargets(queue: Queue) {
  if (queue.stopWatching) return;
  const reconcile = () => {
    const writes = queue.writes.getState();
    const failed = [...writes].filter(([, write]) => write.status === 'failed');
    if (!failed.length) {
      queue.stopWatching?.();
      queue.stopWatching = null;
      return;
    }
    const snapshot = useGameStore.getState().snapshot;
    const tree = useTreeStore.getState().tree;
    const replaced = snapshot?.gameRevision !== queue.game;
    if (!replaced && (!tree || tree.revision !== snapshot?.treeRevision)) return;
    const detached = failed.filter(([id]) => replaced || !tree?.nodes.some((n) => n.id === id));
    if (!detached.length) return;
    const remaining = new Map(writes);
    for (const [id] of detached) remaining.delete(id);
    queue.writes.setState(remaining, true);
  };
  const stopGame = useGameStore.subscribe((state, previous) => {
    if (
      state.snapshot?.treeRevision !== previous.snapshot?.treeRevision ||
      state.snapshot?.gameRevision !== previous.snapshot?.gameRevision
    )
      reconcile();
  });
  const stopTree = useTreeStore.subscribe(reconcile);
  const stopWrites = queue.writes.subscribe(reconcile);
  queue.stopWatching = () => {
    stopGame();
    stopTree();
    stopWrites();
  };
  reconcile();
}

function enqueue(
  queue: Queue,
  node: number,
  text: string,
  send: () => Promise<boolean>,
): Promise<boolean> {
  const { writes } = queue;
  const previous = writes.getState().get(node);
  if (previous?.status === 'pending' && previous.text === text) return previous.done;
  const attempt = previous?.status === 'pending' ? previous.done.then(send) : send();
  const done = attempt.then((ok) => {
    const active = writes.getState().get(node);
    if (active?.status === 'pending' && active.done === done) {
      const next = new Map(writes.getState());
      if (ok) next.delete(node);
      else
        next.set(node, { status: 'failed', text, retry: () => enqueue(queue, node, text, send) });
      writes.setState(next, true);
      if (!ok) {
        watchFailedTargets(queue);
        // A confirmed deletion can settle the failed write during reconciliation.
        return !writes.getState().has(node);
      }
    }
    return ok;
  });
  writes.setState(new Map(writes.getState()).set(node, { status: 'pending', text, done }), true);
  return done;
}

export function writeComment(
  ctx: ActionContext,
  game: number,
  node: number,
  text: string,
  original: string,
  scratchStart: number | null,
) {
  const queue = queueFor(ctx.transport);
  if (queue.game !== game) return Promise.resolve(false);
  if (!queue.writes.getState().has(node) && text === original) return Promise.resolve(true);
  return enqueue(queue, node, text, async () => {
    const snapshot = useGameStore.getState().snapshot;
    if (!snapshot || snapshot.gameRevision !== game || scoringInProgress()) return false;
    if (snapshot.tryout !== null) {
      const tree = useTreeStore.getState().tree;
      // Snapshot events precede tree events. While the tree catches up, the service
      // revalidates the scratch identity established when this field accepted input.
      const allowed =
        tree?.revision === snapshot.treeRevision
          ? tree.nodes.some((n) => n.id === node && n.flags & 2)
          : scratchStart === snapshot.tryout;
      if (!allowed) return false;
    }
    return (await applyEdit(ctx, { kind: 'setComment', node, text: text || null })) !== null;
  });
}

export function registerCommentEditor(transport: Transport, finish: () => void) {
  const { editors } = queueFor(transport);
  editors.add(finish);
  return () => {
    editors.delete(finish);
  };
}

/** Finish mounted fields and retry retained failures once before saving or leaving a record. */
export async function flushCommentEdits(transport: Transport): Promise<boolean> {
  const queue = queueFor(transport);
  for (;;) {
    if (queue !== queueFor(transport)) return false;
    for (const finish of queue.editors) finish();
    const outstanding = Array.from(queue.writes.getState().values(), (write) =>
      write.status === 'failed' ? write.retry() : write.done,
    );
    if (!outstanding.length) return true;
    if ((await Promise.all(outstanding)).includes(false)) return false;
  }
}

/** Called after an explicit Discard for this game. In-flight edits still settle normally. */
export function discardFailedCommentEdits(transport: Transport, gameRevision: number) {
  const queue = queueFor(transport);
  if (queue.game !== gameRevision) return;
  const next = new Map(queue.writes.getState());
  for (const [id, write] of next) if (write.status === 'failed') next.delete(id);
  queue.writes.setState(next, true);
}
