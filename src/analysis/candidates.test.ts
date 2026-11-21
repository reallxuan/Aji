import { expect, it } from 'vitest';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import { catchingUp } from './candidates';

const update = (rootVisits: number, previousVisits: number): AnalysisUpdate => ({
  position: 'aaaaaaaaaaaaaaaa',
  boardSize: 19,
  rootVisits,
  winrate: 0.5,
  scoreLead: 0,
  isFinal: false,
  candidates: [],
  previousVisits,
});

it('a search is catching up while it has fewer visits than the cached one', () => {
  expect(catchingUp(update(640, 1000))).toBe(true);
  expect(catchingUp(update(1000, 1000))).toBe(false);
  expect(catchingUp(update(10, 0))).toBe(false);
});
