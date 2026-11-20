import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { EngineState } from '../transport/generated/EngineState';
import type { PositionKey } from '../transport/generated/PositionKey';
import type { EngineStatus } from '../transport/api';

export interface EngineStoreState {
  engine: EngineState | null;
  analysis: AnalysisUpdate | null;
  /**
   * The position the analysis belongs to; null until the status reply or `setPosition` sets it,
   * and after `clearPosition`. No update is accepted while it is null.
   */
  position: PositionKey | null;
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

export function createEngineStore(): EngineStore {
  return createStore<EngineStoreState>((set) => ({
    engine: null,
    analysis: null,
    position: null,
    positionOwned: false,
    sawAnalysis: false,
    sawEvent: false,
    applyEvent: (event) =>
      set((state) => {
        if (event.type === 'engineState') return { engine: event.engine, sawEvent: true };
        // Install progress is for the setup screens, not the engine store.
        if (event.type !== 'analysisUpdate') return state;
        if (state.position === null || event.analysis.position !== state.position) return state;
        return { analysis: event.analysis, sawAnalysis: true };
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
        return next;
      }),
    setPosition: (position) =>
      set((state) =>
        state.position === position
          ? { positionOwned: true }
          : { position, positionOwned: true, analysis: null, sawAnalysis: false },
      ),
    clearPosition: () =>
      set({ position: null, positionOwned: true, analysis: null, sawAnalysis: false }),
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
