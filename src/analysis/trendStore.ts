import { create } from 'zustand';
import type { TrendNode } from '../transport/generated/TrendNode';
import type { TrendNodeUpdate } from '../transport/generated/TrendNodeUpdate';
import type { TrendStats } from '../transport/generated/TrendStats';

export interface TrendState {
  /** One node per main-line node of the open game, with the engine's cached stats. */
  nodes: TrendNode[];
  /** The session revision the line was read at; `null` before the first trend. */
  revision: number | null;
  setNodes(nodes: TrendNode[], revision?: number | null): void;
  /** Keeps `stats` at `lineIndex` when they are deeper than what is there; ignores a bad index. */
  record(lineIndex: number, stats: TrendStats): void;
  /**
   * Applies the backend's changed nodes for the line read at `revision`; another revision's are
   * for a line this store does not hold, and are ignored. Stats are kept when deeper, losses
   * always taken.
   */
  applyNodes(revision: number, updates: TrendNodeUpdate[]): void;
}

const initial = { nodes: [] as TrendNode[], revision: null as number | null };

const deeper = (incoming: TrendStats | null, existing: TrendStats | null) =>
  incoming && (!existing || incoming.visits >= existing.visits) ? incoming : existing;

export const useTrendStore = create<TrendState>()((set, get) => ({
  ...initial,
  setNodes: (nodes, revision = null) => set({ nodes, revision }),
  record: (lineIndex, stats) => {
    const { nodes } = get();
    const node = nodes[lineIndex];
    if (!node || (node.stats && node.stats.visits >= stats.visits)) return;
    const next = [...nodes];
    next[lineIndex] = { ...node, stats };
    set({ nodes: next });
  },
  applyNodes: (revision, updates) => {
    const { nodes, revision: held } = get();
    if (held !== revision) return;
    const next = [...nodes];
    for (const { lineIndex, stats, loss } of updates) {
      const node = next[lineIndex];
      if (!node) continue;
      next[lineIndex] = { ...node, stats: deeper(stats, node.stats), loss };
    }
    set({ nodes: next });
  },
}));

/** Back to an empty trend. For tests. */
export function resetTrendStore(): void {
  useTrendStore.setState(initial);
}
