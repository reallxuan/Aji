import { BOARD_FLOOR, BOARD_MARGIN, TWO_COLUMN_WIDTH } from './constants';
import type { Layout, Node, PanelRef } from './model';
import { wideDefaultLayout } from './presets';

export type Rect = { x: number; y: number; width: number; height: number };

/** A root column: its index among the root row's children, and its horizontal extent. */
export type Column = { index: number; x: number; width: number };

export type Frame =
  | {
      narrow: false;
      /** The layout as drawn: the untouched default may have become its two-column form. */
      layout: Layout;
      board: Rect;
      /** The board with its margins: the width the board takes in the root row. */
      slot: { x: number; width: number };
      columns: Column[];
      /** Draggable lines between two adjacent root columns; `index` is the left one's. */
      hairlines: Array<{ x: number; index: number }>;
    }
  | { narrow: true; layout: Layout };

type MinSize = (ref: PanelRef) => { width: number; height: number };

/** The narrowest a node can be: a row adds its children, a column takes the widest. */
export function minWidth(node: Node, minSize: MinSize): number {
  switch (node.type) {
    case 'board':
      return 0;
    case 'panel':
      return minSize(node.panel).width;
    case 'tabs':
      return Math.max(...node.panels.map((p) => minSize(p).width));
    case 'split': {
      const widths = node.children.map((c) => minWidth(c, minSize));
      return node.dir === 'row' ? widths.reduce((a, b) => a + b, 0) : Math.max(...widths);
    }
  }
}

/**
 * Shares `total` among items by weight, never below an item's minimum or above its cap. Returns
 * whole pixels; whatever the caps leave over is returned as `rest`.
 */
function share(
  total: number,
  items: Array<{ weight: number; min: number; cap: number }>,
): { widths: number[]; rest: number } {
  const widths = new Array<number>(items.length).fill(0);
  const fixed = new Set<number>();
  for (;;) {
    const free = items.map((_, i) => i).filter((i) => !fixed.has(i));
    const left = total - [...fixed].reduce((a, i) => a + widths[i], 0);
    if (free.length === 0) break;
    const weight = free.reduce((a, i) => a + items[i].weight, 0);
    let changed = false;
    for (const i of free) {
      const w = (left * items[i].weight) / weight;
      if (w < items[i].min) [widths[i], changed] = [items[i].min, true];
      else if (w > items[i].cap) [widths[i], changed] = [items[i].cap, true];
      if (changed) {
        fixed.add(i);
        break;
      }
      widths[i] = w;
    }
    if (!changed) break;
  }
  const whole = widths.map(Math.floor);
  const used = whole.reduce((a, b) => a + b, 0);
  const uncapped = items.map((_, i) => i).filter((i) => whole[i] < items[i].cap);
  let rest = total - used;
  if (uncapped.length > 0) {
    whole[uncapped[uncapped.length - 1]] += rest;
    rest = 0;
  }
  return { widths: whole, rest };
}

function frameFor(layout: Layout, width: number, height: number, minSize: MinSize): Frame {
  const { children, weights } = layout.root;
  const columns = children
    .map((node, index) => ({ node, index, weight: weights[index] }))
    .filter((c) => c.node.type !== 'board');
  const mins = columns.map((c) => minWidth(c.node, minSize));
  const minTotal = mins.reduce((a, b) => a + b, 0);
  const size = Math.floor(Math.min(height - 2 * BOARD_MARGIN, width - 2 * BOARD_MARGIN - minTotal));
  if (height > width || size < BOARD_FLOOR) return { narrow: true, layout };

  const { widths, rest } = share(
    width - size - 2 * BOARD_MARGIN,
    columns.map((c, i) => ({
      weight: c.weight,
      min: mins[i],
      cap: c.node.type === 'split' && c.node.cap !== undefined ? c.node.cap : Infinity,
    })),
  );
  const before = Math.floor(rest / 2);
  const placed: Column[] = [];
  let x = 0;
  let slot = { x: 0, width: 0 };
  let column = 0;
  for (let index = 0; index < children.length; index++) {
    if (children[index].type === 'board') {
      slot = { x, width: size + 2 * BOARD_MARGIN + rest };
      x += slot.width;
    } else {
      placed.push({ index, x, width: widths[column] });
      x += widths[column++];
    }
  }
  const hairlines = placed
    .slice(1)
    .filter((c, i) => placed[i].index === c.index - 1)
    .map((c) => ({ x: c.x, index: c.index - 1 }));
  return {
    narrow: false,
    layout,
    board: { x: slot.x + BOARD_MARGIN + before, y: BOARD_MARGIN, width: size, height: size },
    slot,
    columns: placed,
    hairlines,
  };
}

/**
 * Where everything goes for a window of `width × height` (design 5.1). The board is the largest
 * square the height allows that leaves every column its minimum width. A portrait window, or one
 * that would push the board below its floor, is narrow. The untouched default splits its column
 * in two when that column is wider than 760 px (design 5.2).
 */
export function layoutFrame(
  layout: Layout,
  width: number,
  height: number,
  minSize: MinSize,
): Frame {
  const frame = frameFor(layout, width, height, minSize);
  if (
    frame.narrow ||
    layout.preset !== 'default' ||
    frame.columns.length !== 1 ||
    frame.columns[0].width <= TWO_COLUMN_WIDTH
  ) {
    return frame;
  }
  const wide = frameFor(wideDefaultLayout(), width, height, minSize);
  return wide.narrow ? frame : wide;
}
