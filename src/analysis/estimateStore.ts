import { create } from 'zustand';

/**
 * The position estimate (形势判断, P2 M2 design 5.7): shown or not, for the session. The score
 * it shows arrives with Task 17.
 */
export interface EstimateState {
  on: boolean;
  toggle(): void;
}

export const useEstimateStore = create<EstimateState>()((set) => ({
  on: false,
  toggle: () => set((s) => ({ on: !s.on })),
}));
