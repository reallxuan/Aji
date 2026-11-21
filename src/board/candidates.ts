import type { ShownCandidate } from '../analysis/candidates';
import { formatLead, formatPercentFigure, formatVisits } from '../analysis/format';
import { PLAYED_RING, TIER_STYLE, withAlpha } from '../analysis/palette';
import type { DiscField } from '../transport/generated/DiscField';
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
  const geometry = boardGeometry(cssSize, boardSize);
  const r = geometry.stoneRadius * dpr;
  const px = (css: number) => css * dpr;

  for (const c of discs) {
    if (c.move.type !== 'play') continue;
    const style = TIER_STYLE[c.tier];
    const cx = geometry.lines[c.move.x] * dpr;
    const cy = geometry.lines[c.move.y] * dpr;

    ctx.save();
    if (style.shadow) {
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
      ctx.arc(cx, cy, r + px(PLAYED_RING.width), 0, Math.PI * 2);
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

/** The rank of the disc under a CSS point on the board, within the disc's radius; else `null`. */
export function candidateAt(
  cssX: number,
  cssY: number,
  view: Pick<BoardView, 'cssSize' | 'boardSize'>,
  discs: readonly ShownCandidate[],
): number | null {
  const geometry = boardGeometry(view.cssSize, view.boardSize);
  for (const c of discs) {
    if (c.move.type !== 'play') continue;
    const dx = cssX - geometry.lines[c.move.x];
    const dy = cssY - geometry.lines[c.move.y];
    if (dx * dx + dy * dy <= geometry.stoneRadius * geometry.stoneRadius) return c.rank;
  }
  return null;
}
