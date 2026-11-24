import { useGameStore } from '../game/gameStore';
import { create } from 'zustand';
import type { TrendNode } from '../transport/generated/TrendNode';
import type { TrendNodeUpdate } from '../transport/generated/TrendNodeUpdate';
import type { TrendStats } from '../transport/generated/TrendStats';

export interface TrendState {
  /** One node per selected-line node of the open game, with the engine's cached stats. */
  nodes: TrendNode[];
  /** The line revision the line was read at; `null` before the first trend. */
  lineRevision: number | null;
  setNodes(nodes: TrendNode[], revision?: number | null): void;
  /** Records deeper live stats at every node for the position, including comment-only nodes. */
  record(key: string, stats: TrendStats): void;
  /**
   * Applies the backend's changed nodes for the line read at `revision`; another revision's are
   * for a line this store does not hold, and are ignored. Stats are kept when deeper, losses
   * always taken.
   */
  applyNodes(revision: number, updates: TrendNodeUpdate[]): void;
}

const initial = { nodes: [] as TrendNode[], lineRevision: null as number | null };

const deeper = (incoming: TrendStats | null, existing: TrendStats | null) =>
  incoming && (!existing || incoming.visits >= existing.visits) ? incoming : existing;

export const useTrendStore = create<TrendState>()((set, get) => ({
  ...initial,
  setNodes: (nodes, lineRevision = null) => {
    const previous = get().lineRevision;
    if (previous !== null && lineRevision !== null && previous > lineRevision) return;
    set({ nodes, lineRevision });
  },
  record: (key, stats) => {
    const { nodes } = get();
    let next: TrendNode[] | undefined;
    nodes.forEach((node, i) => {
      if (node.key !== key || (node.stats && node.stats.visits >= stats.visits)) return;
      next ??= [...nodes];
      next[i] = { ...node, stats };
    });
    if (next) set({ nodes: next });
  },
  applyNodes: (revision, updates) => {
    const { nodes, lineRevision: held } = get();
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

/** A trend node ID is valid only while both the displayed line and the open game still match. */
export function currentTrendLine(revision: number | null): boolean {
  return (
    revision !== null &&
    useTrendStore.getState().lineRevision === revision &&
    useGameStore.getState().snapshot?.lineRevision === revision
  );
}
