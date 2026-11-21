import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { EngineState } from '../transport/generated/EngineState';
import type { PositionKey } from '../transport/generated/PositionKey';
import type { Rejection } from '../transport/generated/Rejection';
import type { EngineStatus } from '../transport/api';
import { SPEED_WINDOW_MS } from '../analysis/constants';

export interface EngineStoreState {
  engine: EngineState | null;
  analysis: AnalysisUpdate | null;
  /**
   * The position the analysis belongs to; null until the status reply or `setPosition` sets it,
   * and after `clearPosition`. No update is accepted while it is null.
   */
  position: PositionKey | null;
  /** KataGo refused the current position; cleared when the position changes. */
  rejected: Rejection | null;
  /**
   * Visits per second over the last `SPEED_WINDOW_MS` of updates for the current position, while
   * the engine is analysing; `null` until two samples span some time.
   */
  speed: number | null;
  /** True once the game has set or cleared the position; from then on a status reply is stale. */
  positionOwned: boolean;
  /** True once an analysis update has arrived; from then on a status analysis is stale. */
  sawAnalysis: boolean;
  /** True once a pushed engine-state event has arrived; from then on a status reply is stale. */
  sawEvent: boolean;
  applyEvent(event: AppEvent): void;
  /** Applies a status reply, unless a pushed event has already told us something newer. */
  applyStatus(status: EngineStatus): void;
  /** Switches to another position, dropping the old analysis when the key changes. */
  setPosition(position: PositionKey): void;
  /** The engine analyses nothing (an illegal position): drop the analysis and every update. */
  clearPosition(): void;
}

export type EngineStore = StoreApi<EngineStoreState>;

/** `now` is the clock speed samples are taken with, in milliseconds; tests inject one. */
export function createEngineStore(now: () => number = () => performance.now()): EngineStore {
  // Speed samples for the current position and search, oldest first.
  let samples: Array<{ at: number; visits: number }> = [];

  /** Adds a sample and measures the speed over the window it ends. */
  const sample = (visits: number): number | null => {
    const at = now();
    // Fewer visits than the last sample: a new search began.
    if (samples.length > 0 && visits < samples[samples.length - 1].visits) samples = [];
    samples.push({ at, visits });
    samples = samples.filter((s) => s.at >= at - SPEED_WINDOW_MS);
    const first = samples[0];
    const span = at - first.at;
    if (samples.length < 2 || span <= 0) return null;
    return ((visits - first.visits) * 1000) / span;
  };

  return createStore<EngineStoreState>((set) => ({
    engine: null,
    analysis: null,
    rejected: null,
    speed: null,
    position: null,
    positionOwned: false,
    sawAnalysis: false,
    sawEvent: false,
    applyEvent: (event) =>
      set((state) => {
        if (event.type === 'engineState') {
          if (event.engine.state !== 'analysing') samples = [];
          return {
            engine: event.engine,
            sawEvent: true,
            ...(event.engine.state === 'analysing' ? {} : { speed: null }),
          };
        }
        if (event.type === 'analysisRejected') {
          if (state.position === null || event.rejection.position !== state.position) return state;
          return { rejected: event.rejection };
        }
        // Install progress is for the setup screens, not the engine store.
        if (event.type !== 'analysisUpdate') return state;
        if (state.position === null || event.analysis.position !== state.position) return state;
        const speed =
          state.engine?.state === 'analysing' ? sample(event.analysis.rootVisits) : null;
        return { analysis: event.analysis, sawAnalysis: true, speed };
      }),
    applyStatus: (status) =>
      set((state) => {
        const next: Partial<EngineStoreState> = {};
        if (!state.sawEvent) next.engine = status.engine;
        const position = state.positionOwned ? state.position : status.position;
        if (!state.positionOwned) next.position = status.position;
        if (!state.sawAnalysis && position !== null && position === status.position) {
          next.analysis = status.analysis;
        }
        if (
          state.rejected === null &&
          position !== null &&
          status.rejected?.position === position
        ) {
          next.rejected = status.rejected;
        }
        return next;
      }),
    setPosition: (position) =>
      set((state) => {
        if (state.position === position) return { positionOwned: true };
        samples = [];
        return {
          position,
          positionOwned: true,
          analysis: null,
          sawAnalysis: false,
          rejected: null,
          speed: null,
        };
      }),
    clearPosition: () => {
      samples = [];
      set({
        position: null,
        positionOwned: true,
        analysis: null,
        sawAnalysis: false,
        rejected: null,
        speed: null,
      });
    },
  }));
}

const EngineStoreContext = createContext<EngineStore | null>(null);

export function EngineStoreProvider({
  store,
  children,
}: {
  store: EngineStore;
  children: ReactNode;
}) {
  return <EngineStoreContext.Provider value={store}>{children}</EngineStoreContext.Provider>;
}

export function useEngineStore<T>(selector: (state: EngineStoreState) => T): T {
  const store = useContext(EngineStoreContext);
  if (!store) throw new Error('useEngineStore must be used inside an EngineStoreProvider');
  return useStore(store, selector);
}

export function useEngineStoreApi(): EngineStore {
  const store = useContext(EngineStoreContext);
  if (!store) throw new Error('useEngineStoreApi must be used inside an EngineStoreProvider');
  return store;
}
