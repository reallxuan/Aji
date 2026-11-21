import { create } from 'zustand';
import type { TrendNode } from '../transport/generated/TrendNode';
import type { TrendStats } from '../transport/generated/TrendStats';

export interface TrendState {
  /** One node per main-line node of the open game, with the engine's cached stats. */
  nodes: TrendNode[];
  setNodes(nodes: TrendNode[]): void;
  /** Keeps `stats` at `lineIndex` when they are deeper than what is there; ignores a bad index. */
  record(lineIndex: number, stats: TrendStats): void;
}

const initial = { nodes: [] as TrendNode[] };

export const useTrendStore = create<TrendState>()((set, get) => ({
  ...initial,
  setNodes: (nodes) => set({ nodes }),
  record: (lineIndex, stats) => {
    const { nodes } = get();
    const node = nodes[lineIndex];
    if (!node || (node.stats && node.stats.visits >= stats.visits)) return;
    const next = [...nodes];
    next[lineIndex] = { ...node, stats };
    set({ nodes: next });
  },
}));

/** Back to an empty trend. For tests. */
export function resetTrendStore(): void {
  useTrendStore.setState(initial);
}
