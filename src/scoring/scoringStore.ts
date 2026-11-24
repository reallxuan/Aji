import type { TFunction } from 'i18next';
import { edit } from '../game/editActions';
import { useModeStore } from '../edit/modeStore';
import { create } from 'zustand';
import { engineAction } from '../engine/engineAction';
import type { EngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { useJobStore } from '../job/jobStore';
import { pauseAnalysis, resumeAnalysis, scoreGame } from '../transport/api';
import type { Point } from '../transport/generated/Point';
import type { ScoreView } from '../transport/generated/ScoreView';
import type { Transport } from '../transport/transport';
import { groupAt, samePoint, samePoints } from './groups';

/** What starting needs: the transport, and the engine's state to know whether to pause. */
export interface ScoringContext {
  transport: Transport;
  engine: EngineStore;
  t: TFunction;
}

/**
 * Final scoring (终局点目, P2 M2 design 5.8): KataGo proposes the dead stones, the user decides.
 * The backend counts whatever dead stones it is given; a tap here flips a whole group.
 */
export interface ScoringState {
  active: boolean;
  /** Waiting for the session to finish its undoable try-out edit. */
  starting: boolean;
  /** The stones counted as dead now. */
  dead: Point[];
  /** The stones KataGo's ownership reads as dead. */
  suggested: Point[];
  /** The count with `dead` removed; `null` until it arrives. */
  score: ScoreView | null;
  /** The last count asked for failed; the next one that answers clears it. */
  failed: boolean;
  /** Starting paused the analysis (and so a whole-game job), so leaving resumes it. */
  paused: boolean;
  /** Pauses analysis if it runs, marks KataGo's dead stones, and counts. */
  start(ctx: ScoringContext): Promise<void>;
  /** Flips the group at `point` between dead and alive, and counts again. */
  toggle(transport: Transport, point: Point): Promise<void>;
  /** Back to KataGo's marking. */
  reset(transport: Transport): Promise<void>;
  /** Counts again with the same marking: the rules changed. */
  rescore(transport: Transport): Promise<void>;
  /** Leaves scoring, resuming analysis only if starting paused it. */
  exit(transport: Transport): Promise<void>;
  /** The marking differs from KataGo's. */
  changed(): boolean;
}

const IDLE: Pick<
  ScoringState,
  'active' | 'starting' | 'dead' | 'suggested' | 'score' | 'failed' | 'paused'
> = {
  active: false,
  starting: false,
  dead: [],
  suggested: [],
  score: null,
  failed: false,
  paused: false,
};

/** Each count asked for; an answer to an older one is dropped. */
let asked = 0;
let stopWatching: (() => void) | undefined;

export const useScoringStore = create<ScoringState>()((set, get) => {
  const count = async (transport: Transport, dead: Point[]) => {
    const mine = ++asked;
    set({ dead });
    try {
      const score = await scoreGame(transport, { kind: 'final', dead });
      if (mine === asked && get().active) set({ score, failed: false });
    } catch {
      if (mine === asked && get().active) set({ failed: true });
    }
  };
  return {
    ...IDLE,
    async start(ctx) {
      const { transport, engine } = ctx;
      if (get().active || get().starting) return;
      const mine = ++asked;
      if (useGameStore.getState().snapshot?.tryout != null) {
        set({ starting: true });
        const ended = await edit(ctx, { kind: 'tryoutEnd' });
        if (mine !== asked) return;
        if (!ended || useGameStore.getState().snapshot?.tryout != null) {
          set({ starting: false });
          return;
        }
      }
      const running =
        engineAction(engine.getState().engine, useJobStore.getState().progress) === 'pause';
      useModeStore.getState().setMode('normal');
      stopWatching = useGameStore.subscribe(({ snapshot }) => {
        if (snapshot?.tryout != null) void get().exit(transport);
      });
      set({ ...IDLE, active: true, paused: running });
      if (running) await pauseAnalysis(transport).catch(() => undefined);
      // Any mode reports KataGo's suggestion; the empty marking only asks for it.
      if (mine !== asked || !get().active) return;
      let suggested: Point[];
      try {
        suggested = (await scoreGame(transport, { kind: 'final', dead: [] })).suggestedDead;
      } catch {
        if (mine === asked && get().active) set({ failed: true });
        return;
      }
      if (mine !== asked || !get().active) return;
      set({ suggested });
      await count(transport, suggested);
    },
    async toggle(transport, point) {
      const snapshot = useGameStore.getState().snapshot;
      if (!get().active || !snapshot) return;
      const group = groupAt(snapshot.stones, snapshot.size, point);
      if (group.length === 0) return;
      const { dead } = get();
      const wasDead = dead.some((p) => samePoint(p, point));
      const next = wasDead
        ? dead.filter((p) => !group.some((q) => samePoint(p, q)))
        : [...dead, ...group];
      await count(transport, next);
    },
    async reset(transport) {
      if (get().active) await count(transport, get().suggested);
    },
    async rescore(transport) {
      if (get().active) await count(transport, get().dead);
    },
    async exit(transport) {
      if (!get().active && !get().starting) return;
      stopWatching?.();
      stopWatching = undefined;
      const { paused } = get();
      asked++;
      set({ ...IDLE });
      if (paused) await resumeAnalysis(transport).catch(() => undefined);
    },
    changed: () => !samePoints(get().dead, get().suggested),
  };
});

/** Tests: leave scoring without touching the engine. */
export function resetScoringStore(): void {
  stopWatching?.();
  stopWatching = undefined;
  asked++;
  useScoringStore.setState({ ...IDLE });
}
