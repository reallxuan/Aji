import { describe, expect, it } from 'vitest';
import type { Color } from '../transport/generated/Color';
import { domCanvas } from './canvasFactory';
import { boardGeometry } from './geometry';
import {
  drawOwnership,
  OWNER_FILL,
  OWNER_SQUARE,
  scoredOwnership,
  settledOwnership,
} from './ownership';
import { drawStones, makeStoneSprites } from './stones';

type Event = { type: string; props: Record<string, unknown> };
const events = (ctx: CanvasRenderingContext2D) =>
  (ctx as unknown as { __getEvents(): Event[] }).__getEvents();

function layer() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800;
  return canvas.getContext('2d') as CanvasRenderingContext2D;
}

/** A 5×5 ownership, one signed byte per point, Black's view; stones on the first row. */
const Q = [76, 75, -76, -127, 127, ...Array.from({ length: 20 }, () => 0)];
const STONES: (Color | null)[] = [null, null, null, 'black', 'black', ...Array(20).fill(null)];

describe('settledOwnership', () => {
  it('only_settled_points_get_squares', () => {
    const { owners, dead } = settledOwnership(Q, STONES);
    // 0.6 on KataGo's −1 to 1 scale is 76 of 127; a living stone gets nothing.
    expect(owners.slice(0, 5)).toEqual(['black', null, 'white', 'white', null]);
    expect(owners.slice(5).every((o) => o === null)).toBe(true);
    // The black stone on White's settled point is dead.
    expect(dead).toEqual([{ x: 3, y: 0 }]);
  });
});

describe('scoredOwnership', () => {
  it('squares every owned point but the living stones, and fades the dead', () => {
    // A 2×2 corner: a living black stone, a dead white one, an empty point each way.
    const stones: (Color | null)[] = ['black', 'white', null, null];
    const owners: (Color | null)[] = ['black', 'black', 'black', null];
    const dead = [{ x: 1, y: 0 }];
    expect(scoredOwnership(owners, stones, dead)).toEqual({
      owners: [null, 'black', 'black', null],
      dead,
    });
  });
});

describe('drawing', () => {
  const view = { cssSize: 400, dpr: 2, boardSize: 5 };
  const g = boardGeometry(400, 5);

  it('draws one same-size square per settled point, in its owner’s colour', () => {
    const ctx = layer();
    const { owners } = settledOwnership(Q, STONES);
    drawOwnership(ctx, view, owners);
    const rects = events(ctx).filter((e) => e.type === 'fillRect');
    expect(rects).toHaveLength(3);
    const side = OWNER_SQUARE * g.spacing * 2;
    expect(rects[0].props).toMatchObject({
      x: g.lines[0] * 2 - side / 2,
      y: g.lines[0] * 2 - side / 2,
      width: side,
      height: side,
    });
    const fills = events(ctx)
      .filter((e) => e.type === 'fillStyle')
      .map((e) => e.props.value);
    expect(fills).toEqual([OWNER_FILL.black, OWNER_FILL.white, OWNER_FILL.white]);
  });

  it('dead_stones_fade_under_the_owner_square', () => {
    const ctx = layer();
    const { dead } = settledOwnership(Q, STONES);
    const sprites = makeStoneSprites(g.spacing, 2, domCanvas);
    drawStones(ctx, view, STONES, null, sprites, dead);
    const list = events(ctx);
    const faded = list.findIndex((e) => e.type === 'globalAlpha' && e.props.value === 0.45);
    expect(faded).toBeGreaterThan(-1);
    // The faded stamp is the dead stone's, at D5; the living one at E5 is whole.
    const half = sprites.black.width / 2;
    const stamp = list.slice(faded).find((e) => e.type === 'drawImage')!;
    expect(stamp.props.dx).toBe(Math.round(g.lines[3] * 2 - half));
    const stamps = list.filter((e) => e.type === 'drawImage');
    expect(stamps).toHaveLength(2);
    expect(list.filter((e) => e.type === 'globalAlpha' && e.props.value === 0.45)).toHaveLength(1);
  });
});
