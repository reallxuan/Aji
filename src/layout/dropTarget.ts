import { BOARD_EDGE_BAND, EDGE_ZONE } from './constants';
import type { Rect } from './frameGeometry';
import { type PanelRef, sameRef } from './model';
import type { Drop } from './ops';

export type PanelRect = { ref: PanelRef; rect: Rect };

const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

/**
 * Where a panel dragged to `point` would land (design 5.3). `rects` are the shown panels as
 * measured on screen. An eighth of the board at its left or right edge adds a column there; the
 * rest of the board takes nothing. Over a panel, its outer quarter splits on the nearest side and
 * its middle makes tabs, except that the header takes no tabs. Over the dragged panel itself, or
 * over nothing, the drop is `null`.
 */
export function dropTarget(
  rects: PanelRect[],
  board: Rect,
  point: { x: number; y: number },
  dragged: PanelRef,
): Drop {
  const { x, y } = point;
  if (inside(board, x, y)) {
    const band = board.width * BOARD_EDGE_BAND;
    if (x < board.x + band) return { kind: 'column', side: 'left' };
    if (x >= board.x + board.width - band) return { kind: 'column', side: 'right' };
    return null;
  }
  const hit = rects.find((r) => inside(r.rect, x, y));
  if (!hit || sameRef(hit.ref, dragged)) return null;
  const { rect } = hit;
  const fx = (x - rect.x) / rect.width;
  const fy = (y - rect.y) / rect.height;
  const edges = [
    { side: 'left' as const, d: fx },
    { side: 'right' as const, d: 1 - fx },
    { side: 'top' as const, d: fy },
    { side: 'bottom' as const, d: 1 - fy },
  ];
  const nearest = edges.reduce((a, b) => (b.d < a.d ? b : a));
  const header = hit.ref.kind === 'header' || dragged.kind === 'header';
  if (nearest.d < EDGE_ZONE || header) {
    return { kind: 'split', target: hit.ref, side: nearest.side };
  }
  return { kind: 'tab', target: hit.ref };
}

/** Where the accent outline goes for `drop`: the half it would take, the group, or the band. */
export function outlineRect(drop: Drop, rects: PanelRect[], board: Rect): Rect | null {
  if (!drop) return null;
  if (drop.kind === 'column') {
    const band = board.width * BOARD_EDGE_BAND;
    const x = drop.side === 'left' ? board.x : board.x + board.width - band;
    return { x, y: board.y, width: band, height: board.height };
  }
  const target = rects.find((r) => sameRef(r.ref, drop.target))?.rect;
  if (!target || drop.kind === 'tab') return target ?? null;
  const { x, y, width, height } = target;
  switch (drop.side) {
    case 'left':
      return { x, y, width: width / 2, height };
    case 'right':
      return { x: x + width / 2, y, width: width / 2, height };
    case 'top':
      return { x, y, width, height: height / 2 };
    case 'bottom':
      return { x, y: y + height / 2, width, height: height / 2 };
  }
}
