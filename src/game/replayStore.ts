import { create } from 'zustand';
import { useDeviceStore } from '../device/deviceStore';
import type { Transport } from '../transport/transport';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import { useGameStore } from './gameStore';

interface ReplaySession {
  transport: Transport;
  canStep(): boolean;
  next(): Promise<GameSnapshot | null>;
}
// Stopping cancels future ticks. An RPC already sent can still move the backend.
interface ReplayStep {
  reply: Promise<GameSnapshot | null>;
  tail: Promise<unknown>;
}
const outstanding = new WeakMap<Transport, ReplayStep>();

/** Keep later input behind the step and any earlier input that was waiting for it. */
function holdInput(transport: Transport, step: ReplayStep, work: Promise<unknown>) {
  step.tail = work;
  const release = () => {
    if (step.tail === work && outstanding.get(transport) === step) outstanding.delete(transport);
  };
  void work.then(release, release);
}
let session: ReplaySession | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;
let generation = 0;

export const useReplayStore = create<{ playing: boolean; start(): void; stop(): void }>()(
  (set, get) => ({
    playing: false,
    start() {
      const current = session;
      if (
        !current ||
        get().playing ||
        (useGameStore.getState().snapshot?.atEnd ?? true) ||
        !current.canStep()
      )
        return;
      const run = ++generation;
      let nextIndex: number | null = null;
      const schedule = () => {
        timer = setTimeout(async () => {
          const before = useGameStore.getState().snapshot;
          if (!before || !current.canStep()) return get().stop();
          nextIndex = before.lineIndex + 1;
          const reply = current.next();
          const step = { reply, tail: reply };
          outstanding.set(current.transport, step);
          holdInput(current.transport, step, reply);
          const snapshot = await reply;
          nextIndex = null;
          if (generation !== run) return;
          if (!snapshot || snapshot.atEnd || snapshot.revision <= before.revision) get().stop();
          else schedule();
        }, useDeviceStore.getState().settings.autoReplaySeconds * 1000);
      };
      unsubscribe = useGameStore.subscribe(({ snapshot }, previous) => {
        if (snapshot === previous.snapshot) return;
        // A tick advances exactly one node on the same line. The event can precede the
        // response; a replacement, edit, or a second navigation ends this run.
        if (
          !snapshot ||
          snapshot.atEnd ||
          snapshot.gameRevision !== previous.snapshot?.gameRevision ||
          snapshot.treeRevision !== previous.snapshot.treeRevision ||
          snapshot.lineRevision !== previous.snapshot.lineRevision ||
          snapshot.lineIndex !== nextIndex ||
          snapshot.lineIndex !== previous.snapshot.lineIndex + 1
        )
          get().stop();
      });
      set({ playing: true });
      schedule();
    },
    stop() {
      if (!get().playing) return;
      ++generation;
      clearTimeout(timer);
      unsubscribe?.();
      unsubscribe = undefined;
      set({ playing: false });
    },
  }),
);

export function stopReplay() {
  useReplayStore.getState().stop();
}

/** A gesture or animation frame started while replay's last request was unacknowledged. */
export function captureReplayVisit(transport: Transport): (() => boolean) | undefined {
  if (!outstanding.has(transport)) return;
  return visitGuard();
}

function visitGuard() {
  const { snapshot, nodeVisit } = useGameStore.getState();
  const game = snapshot?.gameRevision;
  return () => {
    const now = useGameStore.getState();
    return now.nodeVisit === nodeVisit && now.snapshot?.gameRevision === game;
  };
}

/** Run at once without a tick in flight. Otherwise wait through snapshot application and
 * discard input from a superseded visit. A pushed snapshot can already be the intended visit. */
export function afterReplay<T>(transport: Transport, run: () => Promise<T>): Promise<T | null> {
  stopReplay();
  const step = outstanding.get(transport);
  if (!step) return run();
  const stillHere = visitGuard();
  const result = Promise.all([step.reply, step.tail]).then(([reply]) =>
    reply && stillHere() ? run() : null,
  );
  holdInput(transport, step, result);
  return result;
}

export function toggleReplay() {
  const replay = useReplayStore.getState();
  if (replay.playing) replay.stop();
  else replay.start();
}

/** Replay follows the active transport for the lifetime of the game session. */
export function bindReplay(current: ReplaySession | null) {
  stopReplay();
  session = current;
}
