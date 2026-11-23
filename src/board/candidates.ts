import type { ShownCandidate } from '../analysis/candidates';
import { formatLead, formatPercentFigure, formatVisits } from '../analysis/format';
import { PLAYED_RING, TIER_STYLE, withAlpha } from '../analysis/palette';
import type { Color } from '../transport/generated/Color';
import type { DiscField } from '../transport/generated/DiscField';
import type { Move } from '../transport/generated/Move';
import type { Point } from '../transport/generated/Point';
import type { BoardView } from './drawBoard';
import { boardGeometry } from './geometry';

/** The best disc's drop shadow, in CSS pixels. */
const BEST_SHADOW = { color: 'rgba(40, 20, 4, 0.35)', blur: 6, offsetY: 2 };

/** One line of a disc: win rate as a bare figure, the lead signed, visits as 1.2k. */
export function discText(c: ShownCandidate, field: DiscField, lang: string): string {
  if (field === 'winrate') return formatPercentFigure(c.winrate, lang);
  if (field === 'scoreLead') return formatLead(c.scoreLead, lang);
  return formatVisits(c.visits, lang);
}

const THICKEST_RING = Math.max(...Object.values(TIER_STYLE).map((style) => style.ringWidth));

/**
 * Clears the candidate layer and draws each disc on its point, a stone's radius across (design
 * 5.6): the tier's fill and ring, the played move's outer ring, and the two `lines` in the side
 * to move's view. Pure: the same arguments always draw the same pixels.
 */
export function drawCandidates(
  ctx: CanvasRenderingContext2D,
  view: BoardView,
  discs: readonly ShownCandidate[],
  lines: [DiscField, DiscField],
  lang: string,
): void {
  const { cssSize, dpr, boardSize } = view;
  const size = Math.round(cssSize * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (size <= 0) return;
  const geometry = boardGeometry(cssSize, boardSize, view.coordinates);
  const r = geometry.stoneRadius * dpr;
  const px = (css: number) => css * dpr;
  // A board so small that a disc cannot hold its ring (a window being dragged narrow) shows no
  // discs, rather than asking the canvas for a negative radius, which throws.
  if (r <= px(THICKEST_RING)) return;

  for (const c of discs) {
    if (c.move.type !== 'play') continue;
    const style = TIER_STYLE[c.tier];
    const cx = geometry.lines[c.move.x] * dpr;
    const cy = geometry.lines[c.move.y] * dpr;

    ctx.save();
    // The printed board is flat: nothing casts a shadow on it (P2 M1 design 5.7).
    if (style.shadow && view.style !== 'printed') {
      ctx.shadowColor = BEST_SHADOW.color;
      ctx.shadowBlur = px(BEST_SHADOW.blur);
      ctx.shadowOffsetY = px(BEST_SHADOW.offsetY);
    }
    ctx.fillStyle = withAlpha(style.fill, style.fillAlpha);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = px(style.ringWidth);
    ctx.strokeStyle = withAlpha(style.ring, style.ringAlpha);
    ctx.beginPath();
    ctx.arc(cx, cy, r - px(style.ringWidth) / 2, 0, Math.PI * 2);
    ctx.stroke();

    if (c.played) {
      ctx.lineWidth = px(PLAYED_RING.width);
      ctx.strokeStyle = PLAYED_RING.color;
      ctx.beginPath();
      // Centred half its width outside the disc, so it starts where the disc ends (design 13.3).
      ctx.arc(cx, cy, r + px(PLAYED_RING.width) / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = style.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${style.bold ? 700 : 600} ${r * 0.62}px Inter`;
    ctx.fillText(discText(c, lines[0], lang), cx, cy - r * 0.2);
    ctx.font = `500 ${r * 0.48}px Inter`;
    ctx.fillText(discText(c, lines[1], lang), cx, cy + r * 0.36);
  }
}

/**
 * The record's next move as the played ring alone, around its empty point (P2 M2 design 5.6):
 * where a disc's ring would sit, the next position having no result yet or the candidates being
 * hidden. Draws over the layer without clearing it.
 */
export function drawNextRing(
  ctx: CanvasRenderingContext2D,
  view: Pick<BoardView, 'cssSize' | 'dpr' | 'boardSize' | 'coordinates'>,
  point: Point,
): void {
  const geometry = boardGeometry(view.cssSize, view.boardSize, view.coordinates);
  const px = (css: number) => css * view.dpr;
  const r = geometry.stoneRadius * view.dpr;
  if (r <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = px(PLAYED_RING.width);
  ctx.strokeStyle = PLAYED_RING.color;
  ctx.beginPath();
  ctx.arc(
    geometry.lines[point.x] * view.dpr,
    geometry.lines[point.y] * view.dpr,
    r + px(PLAYED_RING.width) / 2,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
}

/** The move of the disc under a CSS point on the board, within the disc's radius; else `null`. */
export function candidateAt(
  cssX: number,
  cssY: number,
  view: Pick<BoardView, 'cssSize' | 'boardSize' | 'coordinates'>,
  discs: readonly ShownCandidate[],
): Move | null {
  const geometry = boardGeometry(view.cssSize, view.boardSize, view.coordinates);
  for (const c of discs) {
    if (c.move.type !== 'play') continue;
    const dx = cssX - geometry.lines[c.move.x];
    const dy = cssY - geometry.lines[c.move.y];
    if (dx * dx + dy * dy <= geometry.stoneRadius * geometry.stoneRadius) return c.move;
  }
  return null;
}

/** Move numbers on a hovered line's stones: light on black, dark on white. */
const NUMBER_ON_BLACK = '#f4f1ea';
const NUMBER_ON_WHITE = '#1d1b17';

/**
 * Clears the layer and writes each line stone's move number in its centre (design 5.8). The
 * newest stone of a partial line gets a bold number; no stone gets a ring (design 13.4).
 */
export function drawVariationNumbers(
  ctx: CanvasRenderingContext2D,
  view: BoardView,
  numbers: ReadonlyArray<{ point: Point; n: number }>,
  newest: Point | null,
  stones: readonly (Color | null)[],
): void {
  const { cssSize, dpr, boardSize } = view;
  const size = Math.round(cssSize * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (size <= 0) return;
  const geometry = boardGeometry(cssSize, boardSize, view.coordinates);
  const spacing = geometry.spacing * dpr;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { point, n } of numbers) {
    const stone = stones[point.y * boardSize + point.x];
    if (!stone) continue;
    const ink = stone === 'black' ? NUMBER_ON_BLACK : NUMBER_ON_WHITE;
    const cx = geometry.lines[point.x] * dpr;
    const cy = geometry.lines[point.y] * dpr;
    const isNewest = newest !== null && newest.x === point.x && newest.y === point.y;
    ctx.fillStyle = ink;
    ctx.font = `${isNewest ? 700 : 600} ${0.42 * spacing}px Inter`;
    // Inter's figures sit a little high on the middle baseline.
    ctx.fillText(String(n), cx, cy + 0.03 * spacing);
  }
}
