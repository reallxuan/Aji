import type { Color } from '../transport/generated/Color';
import type { Move } from '../transport/generated/Move';
import { asImage, type CanvasFactory, type OffscreenCanvasLike } from './canvasFactory';
import type { BoardView } from './drawBoard';
import { boardGeometry, STONE_RADIUS_SHARE } from './geometry';
/** The last-move dot is 0.22 of the spacing across. */
const DOT_SHARE = 0.11;
/** Each white stone takes one of this many grain rotations, by point. */
const WHITE_ROTATIONS = 4;

/** Black and white stones drawn once, with their shadows, to be stamped at every point. */
export interface StoneSprites {
  black: OffscreenCanvasLike;
  /** One per grain rotation. */
  white: OffscreenCanvasLike[];
  /** The stone's radius in device pixels. */
  radius: number;
}

/**
 * Draws a stone centred at (c, c) with radius `r`, in the approved mockup's look: a soft offset
 * shadow and a tight contact shadow from a light at the upper left; black is matte slate with a
 * small highlight, white is shell with a faint diagonal grain (`rotation` turns the grain).
 */
function paintStone(
  ctx: CanvasRenderingContext2D,
  c: number,
  r: number,
  color: Color,
  rotation: number,
): void {
  ctx.save();
  ctx.shadowColor = 'rgba(40,24,6,.32)';
  ctx.shadowBlur = r * 0.55;
  ctx.shadowOffsetX = r * 0.14;
  ctx.shadowOffsetY = r * 0.2;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(c, c, r * 0.97, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(30,18,4,.55)';
  ctx.shadowBlur = r * 0.1;
  ctx.shadowOffsetX = r * 0.04;
  ctx.shadowOffsetY = r * 0.06;
  if (color === 'black') {
    const body = ctx.createRadialGradient(c - r * 0.38, c - r * 0.42, r * 0.05, c, c, r);
    body.addColorStop(0, '#6a6a68');
    body.addColorStop(0.28, '#2c2c2b');
    body.addColorStop(0.85, '#121212');
    body.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = body;
  } else {
    const body = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.55, '#f3f0e8');
    body.addColorStop(0.9, '#d9d3c6');
    body.addColorStop(1, '#bfb8aa');
    ctx.fillStyle = body;
  }
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (color === 'black') {
    const highlight = ctx.createRadialGradient(
      c - r * 0.4,
      c - r * 0.45,
      0,
      c - r * 0.4,
      c - r * 0.45,
      r * 0.5,
    );
    highlight.addColorStop(0, 'rgba(255,255,255,.22)');
    highlight.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r * 0.96, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(c, c);
  ctx.rotate(-0.7 + rotation * 0.12);
  ctx.strokeStyle = 'rgba(150,135,110,.10)';
  ctx.lineWidth = Math.max(0.6, r * 0.035);
  for (let k = -r; k < r; k += r * 0.16) {
    ctx.beginPath();
    ctx.moveTo(-r, k);
    ctx.quadraticCurveTo(0, k + r * 0.08, r, k);
    ctx.stroke();
  }
  ctx.restore();
}

function sprite(
  create: CanvasFactory,
  half: number,
  radius: number,
  color: Color,
  rotation: number,
): OffscreenCanvasLike {
  const canvas = create(half * 2, half * 2);
  const ctx = canvas.getContext('2d');
  if (ctx && radius > 0) paintStone(ctx, half, radius, color, rotation);
  return canvas;
}

/**
 * Stone sprites for a board whose lines are `spacing` CSS pixels apart, at `dpr`. The canvas is
 * square with an even side, the stone at its centre, and room for the shadow down and right.
 */
export function makeStoneSprites(
  spacing: number,
  dpr: number,
  create: CanvasFactory,
): StoneSprites {
  const radius = Math.max(0, spacing * STONE_RADIUS_SHARE * dpr);
  // The offset shadow reaches about 0.2 + 0.55 radii past the stone.
  const half = Math.max(1, Math.ceil(radius * 1.8));
  return {
    black: sprite(create, half, radius, 'black', 0),
    white: Array.from({ length: WHITE_ROTATIONS }, (_, i) =>
      sprite(create, half, radius, 'white', i),
    ),
    radius,
  };
}

/**
 * Clears the stone layer and stamps every stone, then the last-move dot. `stones` is row by row
 * (`y * boardSize + x`). Pure: the same arguments always draw the same pixels.
 */
export function drawStones(
  ctx: CanvasRenderingContext2D,
  view: BoardView,
  stones: readonly (Color | null)[],
  lastMove: Move | null,
  sprites: StoneSprites,
): void {
  const { cssSize, dpr, boardSize } = view;
  const size = Math.round(cssSize * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (size <= 0) return;
  const geometry = boardGeometry(cssSize, boardSize, view.coordinates);
  const half = sprites.black.width / 2;
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const stone = stones[y * boardSize + x];
      if (!stone) continue;
      const image =
        stone === 'black' ? sprites.black : sprites.white[(x * 7 + y * 3) % WHITE_ROTATIONS];
      ctx.drawImage(
        asImage(image),
        Math.round(geometry.lines[x] * dpr - half),
        Math.round(geometry.lines[y] * dpr - half),
      );
    }
  }
  if (lastMove?.type !== 'play') return;
  const under = stones[lastMove.y * boardSize + lastMove.x];
  if (!under) return;
  ctx.fillStyle = under === 'black' ? '#f2efe8' : '#1a1a1a';
  ctx.beginPath();
  ctx.arc(
    Math.round(geometry.lines[lastMove.x] * dpr - half) + half,
    Math.round(geometry.lines[lastMove.y] * dpr - half) + half,
    geometry.spacing * DOT_SHARE * dpr,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}
