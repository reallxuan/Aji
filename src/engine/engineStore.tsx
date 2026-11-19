import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { EngineState } from '../transport/generated/EngineState';

export interface EngineStoreState {
  engine: EngineState | null;
  analysis: AnalysisUpdate | null;
  /** True once a pushed engine-state event has arrived; from then on a status reply is stale. */
  sawEvent: boolean;
  applyEvent(event: AppEvent): void;
  /** Applies a status reply, unless a pushed event has already told us something newer. */
  applyStatus(engine: EngineState): void;
}

export type EngineStore = StoreApi<EngineStoreState>;

export function createEngineStore(): EngineStore {
  return createStore<EngineStoreState>((set) => ({
    engine: null,
    analysis: null,
    sawEvent: false,
    applyEvent: (event) =>
      set(
        event.type === 'engineState'
          ? { engine: event.engine, sawEvent: true }
          : { analysis: event.analysis },
      ),
    applyStatus: (engine) => set((state) => (state.sawEvent ? state : { engine })),
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
