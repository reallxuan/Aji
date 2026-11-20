import { boardGeometry } from './geometry';
import { woodTexture } from './wood';

/** Grid lines, star points and coordinates (interface design 5.1). */
const INK = '#3A2A14';
const LABEL_INK = 'rgba(58, 42, 20, 0.8)';
/** Coordinates are 12 CSS px, and shrink on boards too small to fit them. */
const LABEL_SIZE = 12;

export interface BoardView {
  /** The board's side in CSS pixels. */
  cssSize: number;
  /** Device pixels per CSS pixel. */
  dpr: number;
  /** Lines per side: 9, 13 or 19. */
  boardSize: number;
}

/**
 * Draws the empty board into a canvas whose backing store is `cssSize × dpr` pixels. Pure: the
 * same view always draws the same pixels. Works in device pixels throughout, so 1 px lines land
 * on whole pixels and stay sharp at any ratio.
 */
export function drawBoard(ctx: CanvasRenderingContext2D, view: BoardView): void {
  const { cssSize, dpr, boardSize } = view;
  const wood = woodTexture(cssSize, dpr);
  if (!wood) return;
  const geometry = boardGeometry(cssSize, boardSize);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(wood, 0, 0);

  const lineWidth = Math.max(1, Math.round(dpr));
  const edgeWidth = Math.max(lineWidth + 1, Math.round(1.6 * dpr));
  // A line of odd device width is centred on a half pixel, an even one on a whole pixel.
  const snap = (css: number, width: number) => Math.round(css * dpr) + (width % 2 ? 0.5 : 0);
  const first = geometry.lines[0];
  const last = geometry.lines[geometry.lines.length - 1];

  ctx.strokeStyle = INK;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (const position of geometry.lines.slice(1, -1)) {
    const p = snap(position, lineWidth);
    ctx.moveTo(p, snap(first, lineWidth));
    ctx.lineTo(p, snap(last, lineWidth));
    ctx.moveTo(snap(first, lineWidth), p);
    ctx.lineTo(snap(last, lineWidth), p);
  }
  ctx.stroke();

  ctx.lineWidth = edgeWidth;
  const low = snap(first, edgeWidth);
  const high = snap(last, edgeWidth);
  ctx.strokeRect(low, low, high - low, high - low);

  ctx.fillStyle = INK;
  const radius = Math.max(1.5, geometry.spacing * 0.11) * dpr;
  for (const [col, row] of geometry.stars) {
    ctx.beginPath();
    ctx.arc(
      Math.round(geometry.lines[col] * dpr),
      Math.round(geometry.lines[row] * dpr),
      radius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  const labelSize = Math.min(LABEL_SIZE, geometry.margin * 0.5);
  if (labelSize < 6) return;
  ctx.fillStyle = LABEL_INK;
  ctx.font = `${labelSize * dpr}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const band = (geometry.margin / 2) * dpr;
  for (const { label, x } of geometry.columns) ctx.fillText(label, x * dpr, band);
  for (const { label, y } of geometry.rows) ctx.fillText(label, band, y * dpr);
}
