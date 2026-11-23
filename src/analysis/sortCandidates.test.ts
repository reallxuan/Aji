import { expect, it } from 'vitest';
import type { ShownCandidate } from './candidates';
import { nextSort, sortCandidates } from './sortCandidates';

const row = (rank: number, winrate: number, scoreLead: number, visits: number) =>
  ({ rank, winrate, scoreLead, visits }) as ShownCandidate;

const ROWS = [row(1, 0.54, 0.8, 1200), row(2, 0.52, 2.3, 800), row(3, 0.53, -0.4, 900)];
const ranks = (rows: ShownCandidate[]) => rows.map((r) => r.rank);

it('sorts by a column either way, and rank is KataGo’s order', () => {
  expect(ranks(sortCandidates(ROWS, 'winrate', true))).toEqual([1, 3, 2]);
  expect(ranks(sortCandidates(ROWS, 'winrate', false))).toEqual([2, 3, 1]);
  expect(ranks(sortCandidates(ROWS, 'scoreLead', true))).toEqual([2, 1, 3]);
  expect(ranks(sortCandidates(ROWS, 'visits', false))).toEqual([2, 3, 1]);
  expect(ranks(sortCandidates([...ROWS].reverse(), 'rank', true))).toEqual([1, 2, 3]);
  // Ties keep KataGo's order, and the input is left alone.
  const tied = [row(2, 0.5, 0, 10), row(1, 0.5, 0, 10)];
  expect(ranks(sortCandidates(tied, 'winrate', true))).toEqual([1, 2]);
  expect(ranks(tied)).toEqual([2, 1]);
});

it('a header click sorts high to low, then low to high, then back to KataGo’s order', () => {
  const rank = { key: 'rank', descending: true } as const;
  const down = nextSort(rank, 'scoreLead');
  expect(down).toEqual({ key: 'scoreLead', descending: true });
  const up = nextSort(down, 'scoreLead');
  expect(up).toEqual({ key: 'scoreLead', descending: false });
  expect(nextSort(up, 'scoreLead')).toEqual(rank);
  // Another column starts again from high to low.
  expect(nextSort(up, 'visits')).toEqual({ key: 'visits', descending: true });
});
