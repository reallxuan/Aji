// @vitest-environment node
//
// Pixel checks on single features of the board, drawn with Skia. The screenshot tests guard the
// whole image; these say what a feature must look like, so they fail for the right reason.

import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import type { ShownCandidate } from '../analysis/candidates';
import type { Color } from '../transport/generated/Color';
import type { CanvasFactory, OffscreenCanvasLike } from './canvasFactory';
import { drawCandidates, drawVariationNumbers } from './candidates';
import { drawBoard, type BoardView } from './drawBoard';
import { boardGeometry } from './geometry';

const skia: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as OffscreenCanvasLike;

const VIEW: BoardView = { cssSize: 560, dpr: 2, boardSize: 19 };
const SIZE = VIEW.cssSize * VIEW.dpr;

function canvas() {
  const c = createCanvas(SIZE, SIZE);
  return { c, ctx: c.getContext('2d') as unknown as CanvasRenderingContext2D };
}

/** Mean of (r + g + b) / 3 over device pixels x0..x1, y0..y1 (exclusive ends). */
function brightness(
  ctx: CanvasRenderingContext2D,
  [x0, x1]: [number, number],
  [y0, y1]: [number, number],
): number {
  const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  return sum / (data.length / 4);
}

describe('board pixels', () => {
  // Columns between the A and B columns: clear of the coordinates and the grid.
  const g = boardGeometry(VIEW.cssSize, VIEW.boardSize);
  const columns: [number, number] = [
    Math.round((g.lines[0] + g.spacing * 0.3) * VIEW.dpr),
    Math.round((g.lines[0] + g.spacing * 0.7) * VIEW.dpr),
  ];
  const rows = (from: number, height = 2 * VIEW.dpr) => [from, from + height] as [number, number];

  it('a wood board is flat inside its hairline rim (M7 design 13.5, polish design 3)', () => {
    const { ctx } = canvas();
    drawBoard(ctx, VIEW, skia);
    // Past the outermost 2 CSS pixels, no lit strip at the top and no dark strip at the bottom.
    const top = brightness(ctx, columns, rows(2 * VIEW.dpr));
    const belowTop = brightness(ctx, columns, rows(6 * VIEW.dpr));
    const bottom = brightness(ctx, columns, rows(SIZE - 4 * VIEW.dpr));
    const aboveBottom = brightness(ctx, columns, rows(SIZE - 10 * VIEW.dpr));
    expect(Math.abs(top / belowTop - 1)).toBeLessThan(0.02);
    expect(Math.abs(bottom / aboveBottom - 1)).toBeLessThan(0.02);
    // The rim itself: light along the top edge, shade along the bottom.
    expect(brightness(ctx, columns, rows(0, 1))).toBeGreaterThan(belowTop * 1.05);
    expect(brightness(ctx, columns, rows(SIZE - 1, 1))).toBeLessThan(aboveBottom * 0.95);
  });

  it('the printed board has no rim and no finish', () => {
    const { ctx } = canvas();
    drawBoard(ctx, { ...VIEW, style: 'printed' }, skia);
    const top = brightness(ctx, columns, rows(0));
    const bottom = brightness(ctx, columns, rows(SIZE - 2 * VIEW.dpr));
    expect(Math.abs(top / bottom - 1)).toBeLessThan(0.005);
  });

  it('draws coordinates unless they are hidden', () => {
    const shown = canvas();
    const spy = vi.spyOn(shown.ctx, 'fillText');
    drawBoard(shown.ctx, VIEW, skia);
    expect(spy).toHaveBeenCalledTimes(38);
    const hidden = canvas();
    const none = vi.spyOn(hidden.ctx, 'fillText');
    drawBoard(hidden.ctx, { ...VIEW, coordinates: false }, skia);
    expect(none).not.toHaveBeenCalled();
  });

  it('the played ring touches its disc, with no wood between', () => {
    const { ctx } = canvas();
    drawBoard(ctx, VIEW, skia);
    const discs = canvas();
    const played: ShownCandidate = {
      move: { type: 'play', x: 9, y: 9 },
      rank: 2,
      tier: 'close',
      winrate: 0.5,
      scoreLead: 0,
      visits: 100,
      loss: 1,
      played: true,
      pv: [],
    };
    drawCandidates(discs.ctx, VIEW, [played], ['winrate', 'scoreLead'], 'en');
    ctx.drawImage(discs.c as unknown as CanvasImageSource, 0, 0);
    const g = boardGeometry(VIEW.cssSize, VIEW.boardSize);
    const cy = Math.round(g.lines[9] * VIEW.dpr);
    // Just outside the disc's edge, to the right of its centre, along the horizontal grid line's
    // row offset by a pixel so the line itself is not sampled.
    const x = Math.round((g.lines[9] + g.stoneRadius + 0.6) * VIEW.dpr);
    const just = brightness(ctx, [x, x + 1], [cy - 6, cy - 5]);
    expect(just).toBeLessThan(90);
  });

  it('a board too small for a disc ring draws nothing rather than throwing', () => {
    const tiny: BoardView = { cssSize: 30, dpr: 1, boardSize: 19 };
    const layer = createCanvas(30, 30).getContext('2d') as unknown as CanvasRenderingContext2D;
    const best: ShownCandidate = {
      move: { type: 'play', x: 3, y: 3 },
      rank: 1,
      tier: 'best',
      winrate: 0.5,
      scoreLead: 0,
      visits: 100,
      loss: 0,
      played: true,
      pv: [],
    };
    expect(() => drawCandidates(layer, tiny, [best], ['winrate', 'scoreLead'], 'en')).not.toThrow();
  });

  it('no ring marks the newest stone of a stepped variation', () => {
    const { ctx } = canvas();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const stones: (Color | null)[] = Array(19 * 19).fill(null);
    const point = { x: 9, y: 9 };
    stones[point.y * 19 + point.x] = 'black';
    const numbers = canvas();
    drawVariationNumbers(numbers.ctx, VIEW, [{ point, n: 3 }], point, stones);
    ctx.drawImage(numbers.c as unknown as CanvasImageSource, 0, 0);
    const g = boardGeometry(VIEW.cssSize, VIEW.boardSize);
    // Where the old ring ran: 0.37 of a spacing left of the centre, clear of the digit.
    const x = Math.round((g.lines[9] - 0.37 * g.spacing) * VIEW.dpr);
    const y = Math.round(g.lines[9] * VIEW.dpr);
    expect(brightness(ctx, [x - 2, x + 3], [y - 2, y + 3])).toBeLessThan(10);
  });
});
