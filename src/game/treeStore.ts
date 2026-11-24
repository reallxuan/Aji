import { create } from 'zustand';
import type { GameTree } from '../transport/generated/GameTree';

export const useTreeStore = create<{
  tree: GameTree | null;
  apply(tree: GameTree): void;
}>()((set, get) => ({
  tree: null,
  apply: (tree) => {
    const current = get().tree;
    if (!current || current.revision < tree.revision) set({ tree });
  },
}));
