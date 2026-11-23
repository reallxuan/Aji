import type { Color } from '../transport/generated/Color';
import type { Loss } from '../transport/generated/Loss';
import type { Move } from '../transport/generated/Move';
import type { TrendNode } from '../transport/generated/TrendNode';

/** What the swing list measures a loss by (P2 M2 design 5.4). */
export type SwingBy = 'winrate' | 'score';

/** One move that lost more than the threshold. */
export interface SwingRow {
  /** The node after the move, in the trend's main line. */
  lineIndex: number;
  moveNumber: number;
  move: Move | null;
  mover: Color;
  /** The mover's loss: positive is worse, in percentage points and points. */
  loss: Loss;
}

/**
 * Each side's moves whose loss by `by` is at least `threshold`, biggest first (ties in game
 * order). With `afterIndex`, only the moves after that line index. A node without a loss (a
 * position on either side has no result) is never a swing, and a node that repeats a move number
 * (a comment node) is counted once.
 */
export function swings(
  nodes: readonly TrendNode[],
  by: SwingBy,
  threshold: number,
  afterIndex: number | null,
): { black: SwingRow[]; white: SwingRow[] } {
  const black: SwingRow[] = [];
  const white: SwingRow[] = [];
  const seen = new Set<number>();
  nodes.forEach((node, lineIndex) => {
    if (seen.has(node.moveNumber)) return;
    seen.add(node.moveNumber);
    if (!node.mover || !node.loss) return;
    if (afterIndex !== null && lineIndex <= afterIndex) return;
    if (node.loss[by] < threshold) return;
    (node.mover === 'black' ? black : white).push({
      lineIndex,
      moveNumber: node.moveNumber,
      move: node.move,
      mover: node.mover,
      loss: node.loss,
    });
  });
  const order = (a: SwingRow, b: SwingRow) => b.loss[by] - a.loss[by] || a.lineIndex - b.lineIndex;
  return { black: black.sort(order), white: white.sort(order) };
}

/** How many positions of the line have a result, and how many there are (comment nodes once). */
export function coverage(nodes: readonly TrendNode[]): { analysed: number; total: number } {
  const seen = new Map<number, boolean>();
  for (const node of nodes)
    seen.set(node.moveNumber, (seen.get(node.moveNumber) ?? false) || !!node.stats);
  const values = [...seen.values()];
  return { analysed: values.filter(Boolean).length, total: values.length };
}
