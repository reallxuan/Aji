import { expect, it } from 'vitest';
import { badgesFor } from './badges';
import type { Continuation } from '../transport/generated/Continuation';

it('badges letter the continuations in record order, amber for try-out', () => {
  const branches: Continuation[] = [
    { node: 3, mv: { type: 'play', x: 2, y: 2 }, tryout: false },
    { node: 5, mv: { type: 'pass' }, tryout: false },
    { node: 8, mv: { type: 'play', x: 6, y: 4 }, tryout: true },
  ];
  expect(badgesFor(branches.slice(0, 1), [])).toEqual([]);
  expect(badgesFor(branches, [{ move: { type: 'play', x: 6, y: 4 } }])).toEqual([
    { point: { x: 2, y: 2 }, letter: 'A', tryout: false, outlined: true },
    { point: { x: 6, y: 4 }, letter: 'C', tryout: true, outlined: false },
  ]);
});
