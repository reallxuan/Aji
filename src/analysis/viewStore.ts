import { create } from 'zustand';

export interface Hover {
  /** The hovered candidate's rank in the shown set. */
  rank: number;
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
  /** A new game snapshot: what belonged to the old position ends. */
  reset(): void;
}

const initial = { hidden: false, held: false, hover: null };

export const useViewStore = create<ViewState>()((set) => ({
  ...initial,
  toggleHidden: () => set((s) => ({ hidden: !s.hidden })),
  setHeld: (held) => set({ held }),
  setHover: (hover) => set({ hover }),
  reset: () => set({ hover: null }),
}));

/** Back to the start. For tests. */
export function resetViewStore(): void {
  useViewStore.setState(initial);
}
