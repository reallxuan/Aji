import { useMemo } from 'react';
import { useGameStore } from './gameStore';
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

/** In preorder the first child immediately follows its parent. A jump back begins a fork. */
export const hasVariations = (tree: GameTree | null) =>
  tree?.nodes.some((node, i, nodes) => i > 0 && node.parent !== nodes[i - 1].id) ?? false;

export function currentHasVariations() {
  const tree = useTreeStore.getState().tree;
  return tree?.revision === useGameStore.getState().snapshot?.treeRevision && hasVariations(tree);
}

export function useHasVariations() {
  const tree = useTreeStore((s) => s.tree);
  const revision = useGameStore((s) => s.snapshot?.treeRevision);
  return useMemo(() => tree?.revision === revision && hasVariations(tree), [tree, revision]);
}
