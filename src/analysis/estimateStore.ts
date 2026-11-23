import { create } from 'zustand';
import type { ScoreView } from '../transport/generated/ScoreView';

/**
 * The position estimate (形势判断, P2 M2 design 5.7): shown or not, for the session, and the
 * backend's count for the position on the board.
 */
export interface EstimateState {
  on: boolean;
  /** The count for the current position; `null` until its ownership has arrived. */
  score: ScoreView | null;
  toggle(): void;
  setScore(score: ScoreView | null): void;
}

const initial = { on: false, score: null as ScoreView | null };

export const useEstimateStore = create<EstimateState>()((set) => ({
  ...initial,
  toggle: () => set((s) => ({ on: !s.on, score: null })),
  setScore: (score) => set({ score }),
}));

/** Off, with no count. For tests. */
export function resetEstimateStore(): void {
  useEstimateStore.setState(initial);
}
