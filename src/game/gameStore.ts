import { useModeStore } from '../edit/modeStore';
import { create } from 'zustand';
import { useViewStore } from '../analysis/viewStore';
import type { EngineStore } from '../engine/engineStore';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';

export interface GameState {
  /** The open game at its current node; `null` until the first snapshot arrives. */
  snapshot: GameSnapshot | null;
  /** True once the first snapshot request has settled, answered or not. */
  loaded: boolean;
  /** The engine store that follows the game's position. */
  engine: EngineStore | null;
  bindEngine(engine: EngineStore | null): void;
  /**
   * Shows `snapshot` unless one at least as new is shown: the replying client gets each change
   * twice, in the reply and as an event. Hands its position to the engine store, or clears it on
   * an illegal node, so analysis for any other position is dropped.
   */
  apply(snapshot: GameSnapshot): void;
  markLoaded(): void;
}

const initial = { snapshot: null, loaded: false, engine: null };

export const useGameStore = create<GameState>()((set, get) => ({
  ...initial,
  bindEngine: (engine) => set({ engine }),
  apply: (snapshot) => {
    const current = get().snapshot;
    if (current && snapshot.revision <= current.revision) return;
    if (snapshot.tryout !== null) useModeStore.getState().setMode('normal');
    set({ snapshot, loaded: true });
    // A hover and its line belong to the old position.
    useViewStore.getState().reset();
    const engine = get().engine?.getState();
    if (!engine) return;
    if (snapshot.positionKey === null) engine.clearPosition();
    else engine.setPosition(snapshot.positionKey);
  },
  markLoaded: () => set({ loaded: true }),
}));

/** Back to the state before the first snapshot. For tests. */
export function resetGameStore(): void {
  useGameStore.setState(initial);
}
