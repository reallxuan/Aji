import type { Color } from '../transport/generated/Color';
import type { Point } from '../transport/generated/Point';
import type { BoardView } from './drawBoard';
import { boardGeometry } from './geometry';

/**
 * A point is settled when KataGo's ownership is at least 0.6 for one side, on its −1 to 1 scale
 * (P2 M2 design 5.7, "the 0.6 rule"): 76 of the 127 the backend quantises to.
 */
export const SETTLED = 76;
/** A square's side, as a share of the line spacing (next-move-and-ownership mockup, style C). */
export const OWNER_SQUARE = 0.36;
export const OWNER_FILL: Record<Color, string> = {
  black: 'rgba(18, 18, 18, 0.86)',
  white: 'rgba(250, 248, 242, 0.92)',
};
const OWNER_EDGE: Record<Color, string> = {
  black: 'rgba(255, 255, 255, 0.25)',
  white: 'rgba(0, 0, 0, 0.28)',
};
/** How strongly a dead stone shows under its owner's square. */
export const DEAD_ALPHA = 0.45;

export interface Settled {
  /** Each point's settled owner, row by row; `null` where contested or a living stone stands. */
  owners: (Color | null)[];
  /** Stones on a point settled for the other side. */
  dead: Point[];
}

/**
 * The squares the board shows (P2 M2 design 5.7): from `ownership` (one signed byte per point,
 * Black's view, row by row), every settled point that is empty or holds a dead stone.
 */
export function settledOwnership(
  ownership: readonly number[],
  stones: readonly (Color | null)[],
): Settled {
  const size = Math.round(Math.sqrt(stones.length));
  const dead: Point[] = [];
  const owners = stones.map((stone, i): Color | null => {
    const q = ownership[i] ?? 0;
    if (Math.abs(q) < SETTLED) return null;
    const owner: Color = q > 0 ? 'black' : 'white';
    if (stone === owner) return null;
    if (stone) dead.push({ x: i % size, y: Math.floor(i / size) });
    return owner;
  });
  return { owners, dead };
}

/**
 * Clears the ownership layer and draws a same-size square, in its owner's colour, on each point
 * of `owners`. A dead stone, drawn faded below, gets its owner's square on top.
 */
export function drawOwnership(
  ctx: CanvasRenderingContext2D,
  view: Pick<BoardView, 'cssSize' | 'dpr' | 'boardSize' | 'coordinates'>,
  owners: readonly (Color | null)[],
): void {
  const { cssSize, dpr, boardSize } = view;
  const size = Math.round(cssSize * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (size <= 0) return;
  const geometry = boardGeometry(cssSize, boardSize, view.coordinates);
  const side = OWNER_SQUARE * geometry.spacing * dpr;
  ctx.lineWidth = 0.8 * dpr;
  owners.forEach((owner, i) => {
    if (!owner) return;
    const x = geometry.lines[i % boardSize] * dpr - side / 2;
    const y = geometry.lines[Math.floor(i / boardSize)] * dpr - side / 2;
    ctx.fillStyle = OWNER_FILL[owner];
    ctx.fillRect(x, y, side, side);
    ctx.strokeStyle = OWNER_EDGE[owner];
    ctx.strokeRect(x, y, side, side);
  });
}
