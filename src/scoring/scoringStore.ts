import { create } from 'zustand';

/** Final scoring (终局点目, P2 M2 design 5.8): whether the board is in scoring mode. */
export interface ScoringState {
  active: boolean;
  start(): void;
  exit(): void;
}

export const useScoringStore = create<ScoringState>()((set) => ({
  active: false,
  start: () => set({ active: true }),
  exit: () => set({ active: false }),
}));
