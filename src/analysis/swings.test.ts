import { expect, it } from 'vitest';
import type { Loss } from '../transport/generated/Loss';
import type { TrendNode } from '../transport/generated/TrendNode';
import { swings } from './swings';

/** A main line whose move `n` lost `losses[n]` for its mover; Black plays the odd moves. */
function line(losses: Record<number, Loss>, length = 12): TrendNode[] {
  return Array.from({ length }, (_, i) => ({
    node: i,
    key: i.toString(16).padStart(16, '0'),
    moveNumber: i,
    tryout: false,
    toPlay: i % 2 ? 'white' : 'black',
    mover: i === 0 ? null : i % 2 ? 'black' : 'white',
    move: i === 0 ? null : { type: 'play', x: i, y: 3 },
    stats: { winrate: 0.5, scoreLead: 0, visits: 100 },
    loss: i === 0 ? null : (losses[i] ?? { winrate: 0.5, score: 0.1 }),
  }));
}

const numbers = (rows: { moveNumber: number }[]) => rows.map((r) => r.moveNumber);

it('swings_filter_by_threshold_and_side', () => {
  const nodes = line({
    3: { winrate: 12, score: 1 },
    5: { winrate: 6, score: 4 },
    4: { winrate: 8, score: -0.5 },
    7: { winrate: 4.9, score: 3 },
  });
  const byWinrate = swings(nodes, 'winrate', 5, null);
  // Each side's list, biggest loss first.
  expect(numbers(byWinrate.black)).toEqual([3, 5]);
  expect(numbers(byWinrate.white)).toEqual([4]);
  expect(byWinrate.black[0]).toMatchObject({
    lineIndex: 3,
    moveNumber: 3,
    move: { type: 'play', x: 3, y: 3 },
    loss: { winrate: 12, score: 1 },
  });
  const byScore = swings(nodes, 'score', 2, null);
  expect(numbers(byScore.black)).toEqual([5, 7]);
  expect(byScore.white).toEqual([]);
  // A node without a loss (no result on one side of it) is never a swing.
  const gap = line({ 3: { winrate: 12, score: 1 } });
  gap[3] = { ...gap[3], loss: null };
  expect(swings(gap, 'winrate', 5, null).black).toEqual([]);
});

it('after_only_drops_earlier_moves', () => {
  const nodes = line({
    3: { winrate: 12, score: 1 },
    9: { winrate: 6, score: 4 },
    6: { winrate: 8, score: 1 },
  });
  // At move 6: only the moves after it.
  const after = swings(nodes, 'winrate', 5, 6);
  expect(numbers(after.black)).toEqual([9]);
  expect(after.white).toEqual([]);
});
