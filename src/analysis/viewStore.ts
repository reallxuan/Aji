import { create } from 'zustand';
import type { Move } from '../transport/generated/Move';
import { shownLength, type Variation } from './variation';

export interface Hover {
  /**
   * The hovered candidate's move. Ranks reorder as the search deepens, so the move, not the
   * rank, is what the pointer is over.
   */
  move: Move;
  source: 'board' | 'table';
}

export interface ViewState {
  /** F: candidates hidden for the session. */
  hidden: boolean;
  toggleHidden(): void;
  /** Z held: candidates hidden while the key is down. */
  held: boolean;
  setHeld(held: boolean): void;
  hover: Hover | null;
  setHover(hover: Hover | null): void;
  /** The hovered candidate's frozen line, once its preview has arrived. */
  variation: Variation | null;
  /** How many moves of the line show, from 1 to its shown length; `null` without a line. */
  step: number | null;
  /** Shows a line in full, or none. */
  setVariation(variation: Variation | null): void;
  setStep(step: number): void;
  /** A new game snapshot: what belonged to the old position ends. */
  reset(): void;
}

const initial = { hidden: false, held: false, hover: null, variation: null, step: null };

export const useViewStore = create<ViewState>()((set) => ({
  ...initial,
  toggleHidden: () => set((s) => ({ hidden: !s.hidden })),
  setHeld: (held) => set({ held }),
  setHover: (hover) => set({ hover }),
  setVariation: (variation) => set({ variation, step: variation ? shownLength(variation) : null }),
  setStep: (step) => set({ step }),
  reset: () => set({ hover: null, variation: null, step: null }),
}));

/** Back to the start. For tests. */
export function resetViewStore(): void {
  useViewStore.setState(initial);
}
