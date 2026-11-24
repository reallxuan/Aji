import type { Transport } from '../transport/transport';

const pending = new WeakMap<Transport, Set<Promise<unknown>>>();
const locked = new WeakSet<Transport>();

/** Include queued gestures as soon as the user makes them, and individual edit RPCs through
 * the application of their reply. Each operation keeps its existing execution order. */
export function trackMutation<T>(transport: Transport, work: Promise<T>): Promise<T> {
  let set = pending.get(transport);
  if (!set) {
    set = new Set();
    pending.set(transport, set);
  }
  set.add(work);
  return work.finally(() => set.delete(work));
}

export const mutationsPending = (transport: Transport) => !!pending.get(transport)?.size;

export async function drainMutations(transport: Transport) {
  const active = pending.get(transport);
  while (active?.size) await Promise.allSettled([...active]);
}

export const recordLocked = (transport: Transport) => locked.has(transport);

/** The last revision check and the replacement/quit request are one operation. The webview
 * cannot accept new drafts while a large SGF is being installed. Native menu edits consult
 * the same lock. File pickers, confirmations and save writes run outside it. */
export async function commitRecord(transport: Transport, commit: () => Promise<void>) {
  const previous = document.body.inert;
  locked.add(transport);
  document.body.inert = true;
  try {
    await commit();
  } finally {
    document.body.inert = previous;
    locked.delete(transport);
  }
}
