import { createStore, useStore } from 'zustand';
import type { ActionContext } from './actions';
import { applyEdit } from './editActions';
import { useGameStore } from './gameStore';
import { useTreeStore } from './treeStore';
import { scoringInProgress } from '../scoring/scoringStore';
import type { InfoField } from '../transport/generated/InfoField';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { SessionEdit } from '../transport/generated/SessionEdit';
import type { Transport } from '../transport/transport';

type Field = number | InfoField | 'rules';
type Value = string | AnalysisRules | null;
type Write<T = Value> =
  | { value: T; status: 'pending'; done: Promise<boolean>; stillApplies?: () => boolean }
  | { value: T; status: 'failed'; retry: () => Promise<boolean> };

function newQueue(game: number | undefined) {
  return {
    game,
    version: 0,
    stopWatching: null as (() => void) | null,
    writes: createStore(() => new Map<Field, Write>()),
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

export function usePendingField(transport: Transport, field: number): Write<string> | undefined;
export function usePendingField(
  transport: Transport,
  field: InfoField,
): Write<string | null> | undefined;
export function usePendingField(
  transport: Transport,
  field: 'rules',
): Write<AnalysisRules | null> | undefined;
export function usePendingField(transport: Transport, field: Field) {
  return useStore(queueFor(transport).writes, (writes) => writes.get(field));
}

/** Synchronous counterpart for a queued action that must recheck the current rules draft. */
export function readPendingRules(transport: Transport): AnalysisRules | null | undefined {
  const value = queueFor(transport).writes.getState().get('rules')?.value;
  return typeof value === 'object' ? value : undefined;
}

/** A retained draft belongs to an attached SGF node. An undo can reattach its ID, so
 * forget a detached draft as soon as a matching snapshot and tree confirm removal. */
function watchFailedTargets(queue: Queue) {
  if (queue.stopWatching) return;
  const reconcile = () => {
    const writes = queue.writes.getState();
    const failed = [...writes].filter(
      ([id, write]) => typeof id === 'number' && write.status === 'failed',
    );
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
  field: Field,
  value: Value,
  send: () => Promise<boolean>,
  stillApplies?: () => boolean,
): Promise<boolean> {
  const { writes } = queue;
  const previous = writes.getState().get(field);
  // Equal RE text can come from different counts. Only identical guards share a write.
  if (
    previous?.status === 'pending' &&
    previous.value === value &&
    previous.stillApplies === stillApplies
  )
    return previous.done;
  if (!previous || previous.value !== value) queue.version++;
  const attempt = previous?.status === 'pending' ? previous.done.then(send) : send();
  const done = attempt.then((ok) => {
    const active = writes.getState().get(field);
    if (active?.status === 'pending' && active.done === done) {
      const next = new Map(writes.getState());
      if (ok) next.delete(field);
      else
        next.set(field, {
          status: 'failed',
          value,
          retry: () => enqueue(queue, field, value, send, stillApplies),
        });
      writes.setState(next, true);
      if (!ok && typeof field === 'number') {
        watchFailedTargets(queue);
        // A confirmed deletion can settle the failed write during reconciliation.
        return !writes.getState().has(field);
      }
    }
    return ok;
  });
  writes.setState(
    new Map(writes.getState()).set(field, { status: 'pending', value, done, stillApplies }),
    true,
  );
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

type RootEdit = Extract<SessionEdit, { kind: 'setInfo' | 'setRules' }>;

/** Serialize changes to each root field; the latest value remains visible until it settles. */
export function writeRootField(
  ctx: Pick<ActionContext, 'transport' | 't'>,
  game: number,
  change: RootEdit,
  stillApplies?: () => boolean,
) {
  const queue = queueFor(ctx.transport);
  if (queue.game !== game) return Promise.resolve(false);
  const field = change.kind === 'setInfo' ? change.field : 'rules';
  const value = change.kind === 'setInfo' ? change.value : change.rules;
  // A queued score hand-off can expire before its turn or a retry. Drop that hand-off.
  if (stillApplies && !stillApplies()) return Promise.resolve(true);
  return enqueue(
    queue,
    field,
    value,
    async () => {
      if (stillApplies && !stillApplies()) return true;
      const snapshot = useGameStore.getState().snapshot;
      if (!snapshot || snapshot.gameRevision !== game || snapshot.tryout !== null) return false;
      if (change.kind === 'setInfo' && snapshot.info[change.field] === change.value) return true;
      return (await applyEdit(ctx, change)) !== null;
    },
    stillApplies,
  );
}

export function registerRecordEditor(transport: Transport, finish: () => void) {
  const { editors } = queueFor(transport);
  editors.add(finish);
  return () => {
    editors.delete(finish);
  };
}

/** Finish any new typing while a picker or a file read was pending. Retries of an
 * unchanged draft keep the same version, including a draft the user chose to discard. */
export function recordFieldVersion(transport: Transport): number {
  const queue = queueFor(transport);
  for (const finish of queue.editors) finish();
  return queue.version;
}

/** Finish mounted fields and retry retained failures once before saving or leaving a record. */
export async function flushRecordFields(transport: Transport): Promise<boolean> {
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
export function discardFailedRecordFields(transport: Transport, gameRevision: number) {
  const queue = queueFor(transport);
  if (queue.game !== gameRevision) return;
  const next = new Map(queue.writes.getState());
  for (const [id, write] of next) if (write.status === 'failed') next.delete(id);
  queue.writes.setState(next, true);
}
