import type { Color } from '../transport/generated/Color';
import type { GameTree } from '../transport/generated/GameTree';

export interface TreeCell {
  id: number;
  depth: number;
  lane: number;
  color: Color | null;
  flags: number;
  parent: number | null;
  moveNumber: number;
}

export interface TreeLayout {
  cells: TreeCell[];
  depth: number;
  lanes: number;
  byId: Map<number, TreeCell>;
  byDepth: TreeCell[][];
}

export interface TreeWindow {
  from: number;
  to: number;
  laneFrom: number;
  laneTo: number;
}

/** Preorder stores a line of first children contiguously, followed by its variations. Keep
 * the lowest occupied lane at each depth, including the bend at the variation's parent.
 * Each line visits its own depths and one branch point, regardless of the number of lanes. */
export function layoutTree({ nodes }: GameTree): TreeLayout {
  const cells: TreeCell[] = [];
  const byId = new Map<number, TreeCell>();
  const byDepth: TreeCell[][] = [];
  const nextLane: number[] = [];
  let lanes = 0;
  for (let first = 0; first < nodes.length;) {
    let end = first + 1;
    while (end < nodes.length && nodes[end].parent === nodes[end - 1].id) end++;
    const parentId = nodes[first].parent;
    const parent = parentId === null ? undefined : byId.get(parentId);
    const depth = (parent?.depth ?? -1) + 1;
    const lastDepth = depth + end - first - 1;
    const branchPoint = Math.max(0, depth - 1);
    let lane = 0;
    for (let d = branchPoint; d <= lastDepth; d++) lane = Math.max(lane, nextLane[d] ?? 0);
    for (let d = branchPoint; d <= lastDepth; d++) nextLane[d] = lane + 1;
    lanes = Math.max(lanes, lane + 1);
    let moveNumber = parent?.moveNumber ?? 0;
    for (let i = first; i < end; i++) {
      const { id, parent, color, flags, mv } = nodes[i];
      if (mv !== null) moveNumber++;
      const cell = { id, parent, color, flags, depth: depth + i - first, lane, moveNumber };
      cells.push(cell);
      byId.set(id, cell);
      (byDepth[cell.depth] ??= []).push(cell);
    }
    first = end;
  }
  return { cells, byId, byDepth, depth: byDepth.length, lanes };
}

// At one depth the preorder visits both children and their parents in ascending lane order.
function firstVisibleLane(row: TreeCell[], lane: number): number {
  let low = 0;
  let high = row.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (row[mid].lane < lane) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function visibleCells(layout: TreeLayout, w: TreeWindow) {
  const cells: TreeCell[] = [];
  for (let d = Math.max(0, w.from); d <= Math.min(w.to, layout.depth - 1); d++) {
    const row = layout.byDepth[d];
    for (let i = firstVisibleLane(row, w.laneFrom); i < row.length; i++) {
      const c = row[i];
      if (c.lane > w.laneTo) break;
      cells.push(c);
    }
  }
  return cells;
}

/** A bend at the parent's depth can cross the window with both endpoints offscreen. */
export function visibleEdges(layout: TreeLayout, w: TreeWindow) {
  const edges: TreeCell[] = [];
  for (let d = Math.max(1, w.from); d <= Math.min(w.to + 1, layout.depth - 1); d++) {
    const row = layout.byDepth[d];
    for (let i = firstVisibleLane(row, w.laneFrom); i < row.length; i++) {
      const c = row[i];
      if (c.lane > w.laneTo) {
        const parent = layout.byId.get(c.parent!)!;
        if (d - 1 < w.from || parent.lane > w.laneTo) break;
      }
      edges.push(c);
    }
  }
  return edges;
}
