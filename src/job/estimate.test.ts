import { expect, it } from 'vitest';
import type { TrendNode } from '../transport/generated/TrendNode';
import { DEFAULT_JOB_OPTIONS, jobEstimate } from './estimate';

/** `count` nodes of a plain game; `analysed` of them hold results at `visits`. */
function line(count: number, analysed: (i: number) => boolean = () => false, visits = 500) {
  return Array.from({ length: count }, (_, i): TrendNode => ({
    moveNumber: i,
    mover: i === 0 ? null : i % 2 ? 'black' : 'white',
    move: i === 0 ? null : { type: 'pass' },
    stats: analysed(i) ? { winrate: 0.5, scoreLead: 0, visits } : null,
    loss: null,
  }));
}

it('job panel estimate follows range side and boost', () => {
  const nodes = line(249, (i) => i < 126);
  // 249 positions, 126 with results: 123 left, at 500 visits and 1000 visits a second.
  expect(jobEstimate(nodes, DEFAULT_JOB_OPTIONS, 1000)).toEqual({
    positions: 123,
    cached: 126,
    seconds: 61.5,
  });
  // Moves 60 to 140: the positions before move 60 to after move 140.
  const range = { ...DEFAULT_JOB_OPTIONS, range: { kind: 'moves' as const, from: 60, to: 140 } };
  expect(jobEstimate(nodes, range, null)).toEqual({ positions: 15, cached: 67, seconds: null });
  // Black alone: the positions with Black to move, the even ones.
  const black = { ...DEFAULT_JOB_OPTIONS, side: 'black' as const };
  expect(jobEstimate(line(249), black, 1000).positions).toBe(125);
  // Results short of the budget do not count as done.
  expect(
    jobEstimate(
      line(10, () => true, 300),
      DEFAULT_JOB_OPTIONS,
      null,
    ).cached,
  ).toBe(0);
  // A comment node repeats its position: it is planned once.
  const commented = line(4);
  commented.splice(2, 0, { ...commented[1], mover: null, move: null });
  expect(jobEstimate(commented, DEFAULT_JOB_OPTIONS, null).positions).toBe(4);
});
