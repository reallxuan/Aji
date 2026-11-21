import { describe, expect, it } from 'vitest';
import type { Color } from '../transport/generated/Color';
import type { Move } from '../transport/generated/Move';
import { linePrefix, shownLength, variationBoard, type Variation } from './variation';

const p = (x: number, y: number): Move => ({ type: 'play', x, y });
const PASS: Move = { type: 'pass' };
const N = 5;
const empty = (): (Color | null)[] => Array(N * N).fill(null);
const at = (x: number, y: number) => y * N + x;

function line(
  moves: Move[],
  captured: Array<Array<{ x: number; y: number }>> = [],
  illegalAt: number | null = null,
): Variation {
  return {
    moves,
    colors: moves.map((_, i) => (i % 2 ? 'white' : 'black')),
    captured: moves.map((_, i) => captured[i] ?? []),
    illegalAt,
  };
}

describe('linePrefix', () => {
  it('stops before a pass and at twenty', () => {
    expect(linePrefix([p(0, 0), p(1, 0), PASS, p(2, 0)])).toEqual([p(0, 0), p(1, 0)]);
    expect(linePrefix([PASS, p(0, 0)])).toEqual([]);
    const long = Array.from({ length: 25 }, (_, i) => p(i % 19, Math.floor(i / 19)));
    expect(linePrefix(long)).toHaveLength(20);
  });
});

describe('variationBoard', () => {
  it('applies captures per step', () => {
    // White at (0,0) is captured by Black's second move at (0,1).
    const base = empty();
    base[at(1, 0)] = 'black';
    const v = line([p(4, 4), p(0, 0), p(0, 1)], [[], [], [{ x: 0, y: 0 }]]);
    const two = variationBoard(base, N, v, 2);
    expect(two.stones[at(0, 0)]).toBe('white');
    expect(two.numbers).toEqual([
      { point: { x: 4, y: 4 }, n: 1 },
      { point: { x: 0, y: 0 }, n: 2 },
    ]);
    const three = variationBoard(base, N, v, 3);
    expect(three.stones[at(0, 0)]).toBeNull();
    expect(three.stones[at(0, 1)]).toBe('black');
    expect(three.numbers.map((n) => n.n)).toEqual([1, 3]);
    // The base board is not changed.
    expect(base[at(0, 1)]).toBeNull();
  });

  it('shows the later number on a point played twice', () => {
    const v = line([p(0, 0), p(1, 1), p(2, 2), p(0, 0)], [[], [], [], []]);
    // As if (0,0) were captured by move 3 and played again by White at move 4.
    v.captured[2] = [{ x: 0, y: 0 }];
    const board = variationBoard(empty(), N, v, 4);
    expect(board.stones[at(0, 0)]).toBe('white');
    expect(board.numbers.find((n) => n.point.x === 0 && n.point.y === 0)?.n).toBe(4);
    expect(board.numbers).toHaveLength(3);
  });

  it('stops at the first illegal move', () => {
    const v = line([p(0, 0), p(1, 1), p(2, 2)], [], 1);
    expect(shownLength(v)).toBe(1);
    const board = variationBoard(empty(), N, v, 3);
    expect(board.stones.filter(Boolean)).toHaveLength(1);
    expect(board.numbers).toEqual([{ point: { x: 0, y: 0 }, n: 1 }]);
    expect(board.newest).toBeNull();
  });

  it('marks the newest stone only on a partial line', () => {
    const v = line([p(0, 0), p(1, 1), p(2, 2)]);
    expect(variationBoard(empty(), N, v, 3).newest).toBeNull();
    expect(variationBoard(empty(), N, v, 2).newest).toEqual({ x: 1, y: 1 });
  });
});
