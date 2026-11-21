// @vitest-environment node
//
// Pixel checks on single features of the board, drawn with Skia. The screenshot tests guard the
// whole image; these say what a feature must look like, so they fail for the right reason.

import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
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
  it('the board is flat: no lit strip at the top, no dark strip at the bottom', () => {
    const { ctx } = canvas();
    drawBoard(ctx, VIEW, skia);
    const g = boardGeometry(VIEW.cssSize, VIEW.boardSize);
    // Between the A and B columns: clear of the coordinates and the grid.
    const columns: [number, number] = [
      Math.round((g.lines[0] + g.spacing * 0.3) * VIEW.dpr),
      Math.round((g.lines[0] + g.spacing * 0.7) * VIEW.dpr),
    ];
    const rows = (from: number) => [from, from + 2 * VIEW.dpr] as [number, number];
    const top = brightness(ctx, columns, rows(0));
    const bottom = brightness(ctx, columns, rows(SIZE - 2 * VIEW.dpr));
    // The same columns a little inside each edge, still outside the grid.
    const belowTop = brightness(ctx, columns, rows(6 * VIEW.dpr));
    const aboveBottom = brightness(ctx, columns, rows(SIZE - 10 * VIEW.dpr));
    expect(Math.abs(top / belowTop - 1)).toBeLessThan(0.02);
    expect(Math.abs(bottom / aboveBottom - 1)).toBeLessThan(0.02);
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
