import { expect, it } from 'vitest';
import { numbersFor } from './moveNumbers';

it('the numbered stones follow the display range and branch numbering', () => {
  const points = [0, 1, 2].map((x) => ({ x, y: 0 }));
  const placed = points.map((point, i) => ({
    point,
    node: i + 3,
    number: i + 8,
    branchNumber: i || null,
  }));
  const settings = { mode: 'all', last: 2, restartInBranch: false, lastOn: 'all' } as const;
  expect(numbersFor(placed, 10, { ...settings, mode: 'off' })).toEqual([]);
  expect(numbersFor(placed, 10, { ...settings, mode: 'last' })).toEqual([
    { point: points[1], n: 9 },
    { point: points[2], n: 10 },
  ]);
  expect(numbersFor(placed, 10, { ...settings, restartInBranch: true })).toEqual([
    { point: points[1], n: 1 },
    { point: points[2], n: 2 },
  ]);
});
