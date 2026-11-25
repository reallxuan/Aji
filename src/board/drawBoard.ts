import type { Orientation } from './orientation';
import { asImage, type CanvasFactory, domCanvas } from './canvasFactory';
import { boardGeometry } from './geometry';
import type { BoardId } from '../device/deviceSettings';
import { BOARD_STYLES } from './styles';
import { woodTexture } from './wood';

/** Coordinates are 12 CSS px, and shrink on boards too small to fit them. */
const LABEL_SIZE = 12;

export interface BoardView {
  /** The board's side in CSS pixels. */
  cssSize: number;
  /** Device pixels per CSS pixel. */
  dpr: number;
  /** Lines per side: 9, 13 or 19. */
  boardSize: number;
  /** Coordinates in the margin; `false` hides them and shrinks the margin. Default `true`. */
  coordinates?: boolean;
  /** The board style (P2 M1 design 5.7). Default honey. */
  style?: BoardId;
  orientation?: Orientation;
  /** The wood's grain strength, 0 to 1 (polish design 3). Default `DEFAULT_GRAIN_STRENGTH`. */
  grain?: number;
}

/**
 * Draws the empty board (wood, grid, star points, coordinates) into a canvas whose backing store is `cssSize × dpr` pixels. Pure: the
 * same view always draws the same pixels. Works in device pixels throughout, so 1 px lines land
 * on whole pixels and stay sharp at any ratio.
 */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  view: BoardView,
  create: CanvasFactory = domCanvas,
): void {
  const { cssSize, dpr, boardSize } = view;
  const style = BOARD_STYLES[view.style ?? 'honey'];
  const wood = woodTexture(cssSize, dpr, create, style, view.grain);
  if (!wood) return;
  const geometry = boardGeometry(cssSize, boardSize, view.coordinates, view.orientation);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(asImage(wood), 0, 0);

  const lineWidth = Math.max(1, Math.round(dpr * style.lineWeight));
  const edgeWidth = Math.max(lineWidth + 1, Math.round(1.6 * dpr * style.lineWeight));
  // A line of odd device width is centred on a half pixel, an even one on a whole pixel.
  const snap = (css: number, width: number) => Math.round(css * dpr) + (width % 2 ? 0.5 : 0);
  const first = geometry.lines[0];
  const last = geometry.lines[geometry.lines.length - 1];

  ctx.strokeStyle = style.line;
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

  ctx.fillStyle = style.star;
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

  if (style.grain) drawRim(ctx, Math.round(cssSize * dpr), dpr);

  // Coordinates sit in the band outside the stones, so an edge stone never covers one.
  if (view.coordinates === false) return;
  const labelSize = Math.min(LABEL_SIZE, geometry.labelBand * 0.65);
  if (labelSize < 6) return;
  ctx.fillStyle = style.label;
  ctx.font = `${labelSize * dpr}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const band = (geometry.labelBand / 2) * dpr;
  for (const { label, x } of geometry.columns) ctx.fillText(label, x * dpr, band);
  for (const { label, y } of geometry.rows) ctx.fillText(label, band, y * dpr);
}

/**
 * A wood board's bevelled rim (polish design 3): a hairline of light along the top and left
 * edges and of shade along the bottom and right, as on a board lit from the upper left. It stays
 * within the outermost 2 CSS pixels, so the surface inside is as flat as before (M7 design 13.5).
 */
function drawRim(ctx: CanvasRenderingContext2D, size: number, dpr: number): void {
  const edge = Math.min(2 * dpr, Math.max(dpr, Math.round(size * 0.002)));
  ctx.fillStyle = 'rgba(255, 246, 226, 0.45)';
  ctx.fillRect(0, 0, size, edge);
  ctx.fillRect(0, edge, edge, size - edge);
  ctx.fillStyle = 'rgba(40, 20, 0, 0.32)';
  ctx.fillRect(edge, size - edge, size - edge, edge);
  ctx.fillRect(size - edge, edge, edge, size - 2 * edge);
}
