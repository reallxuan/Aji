import { describe, expect, it } from 'vitest';
import type { Color } from '../transport/generated/Color';
import type { Move } from '../transport/generated/Move';
import { domCanvas } from './canvasFactory';
import { boardGeometry } from './geometry';
import { drawStones, makeStoneSprites } from './stones';

type DrawCall = { type: string; props: Record<string, unknown> };

function layer(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  return {
    ctx,
    calls: () => (ctx as unknown as { __getDrawCalls(): DrawCall[] }).__getDrawCalls(),
  };
}

function board(size: number, placed: Array<[number, number, Color]>): (Color | null)[] {
  const stones: (Color | null)[] = Array.from({ length: size * size }, () => null);
  for (const [x, y, c] of placed) stones[y * size + x] = c;
  return stones;
}

describe('drawStones', () => {
  const view = { cssSize: 400, dpr: 2, boardSize: 9 };
  const spacing = boardGeometry(400, 9).spacing;

  it('stamps one sprite per stone at its point', () => {
    const sprites = makeStoneSprites(spacing, 2, domCanvas);
    const { ctx, calls } = layer(800);
    const stones = board(9, [
      [2, 3, 'black'],
      [6, 6, 'white'],
      [0, 8, 'white'],
    ]);
    drawStones(ctx, view, stones, null, sprites);
    const images = calls().filter((c) => c.type === 'drawImage');
    expect(images).toHaveLength(3);
    const g = boardGeometry(400, 9);
    const half = sprites.black.width / 2;
    expect(images[0].props.img).toBe(sprites.black);
    expect(images[0].props.dx).toBe(Math.round(g.lines[2] * 2 - half));
    expect(images[0].props.dy).toBe(Math.round(g.lines[3] * 2 - half));
    // White sprites rotate by point: (x * 7 + y * 3) % 4.
    expect(images[1].props.img).toBe(sprites.white[(6 * 7 + 6 * 3) % 4]);
    expect(images[2].props.img).toBe(sprites.white[(0 * 7 + 8 * 3) % 4]);
  });

  it('draws the last-move dot after the stones, in the opposite colour', () => {
    const sprites = makeStoneSprites(spacing, 2, domCanvas);
    const { ctx, calls } = layer(800);
    const lastMove: Move = { type: 'play', x: 4, y: 4 };
    drawStones(
      ctx,
      view,
      board(9, [
        [4, 4, 'black'],
        [1, 1, 'white'],
      ]),
      lastMove,
      sprites,
    );
    const drawn = calls();
    const lastImage = drawn.map((c) => c.type).lastIndexOf('drawImage');
    const fill = drawn.findIndex((c) => c.type === 'fill');
    expect(fill).toBeGreaterThan(lastImage);
    // The dot is the layer's last fill: light on a black stone.
    expect(ctx.fillStyle).toBe('#f2efe8');
    drawStones(ctx, view, board(9, [[4, 4, 'white']]), lastMove, sprites);
    expect(ctx.fillStyle).toBe('#1a1a1a');
  });

  it('draws no dot for a pass or an empty point', () => {
    const sprites = makeStoneSprites(spacing, 2, domCanvas);
    for (const lastMove of [{ type: 'pass' } as Move, { type: 'play', x: 0, y: 0 } as Move]) {
      const { ctx, calls } = layer(800);
      drawStones(ctx, view, board(9, [[4, 4, 'white']]), lastMove, sprites);
      expect(calls().filter((c) => c.type === 'fill')).toHaveLength(0);
    }
  });

  it('makes sprites 0.96 of the spacing across, with room for the shadow', () => {
    const sprites = makeStoneSprites(20, 1.5, domCanvas);
    expect(sprites.radius).toBeCloseTo(20 * 0.48 * 1.5);
    expect(sprites.white).toHaveLength(4);
    expect(sprites.black.width).toBeGreaterThan(2 * sprites.radius);
    expect(sprites.black.width % 2).toBe(0);
  });
});
