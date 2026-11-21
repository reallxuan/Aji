import { describe, expect, it } from 'vitest';
import type { ShownCandidate } from '../analysis/candidates';
import type { Move } from '../transport/generated/Move';
import { candidateAt } from './candidates';
import { boardGeometry } from './geometry';

const disc = (rank: number, move: Move): ShownCandidate => ({
  move,
  rank,
  tier: rank === 1 ? 'best' : 'close',
  winrate: 0.5,
  scoreLead: 0,
  visits: 100,
  loss: rank - 1,
  played: false,
  pv: [move],
});

describe('candidateAt', () => {
  for (const boardSize of [19, 9, 5]) {
    it(`hits inside the radius and misses outside it on ${boardSize}×${boardSize}`, () => {
      const view = { cssSize: 560, boardSize };
      const g = boardGeometry(560, boardSize);
      const last = boardSize - 1;
      const discs = [
        disc(1, { type: 'play', x: 2, y: 2 }),
        disc(2, { type: 'play', x: last, y: 0 }),
      ];
      const [cx, cy] = [g.lines[2], g.lines[2]];
      expect(candidateAt(cx, cy, view, discs)).toEqual(discs[0].move);
      expect(candidateAt(cx + g.stoneRadius * 0.95, cy, view, discs)).toEqual(discs[0].move);
      expect(candidateAt(cx, cy - g.stoneRadius * 0.95, view, discs)).toEqual(discs[0].move);
      expect(candidateAt(cx + g.stoneRadius * 1.05, cy, view, discs)).toBeNull();
      expect(candidateAt(g.lines[last], g.lines[0], view, discs)).toEqual(discs[1].move);
    });
  }

  it('never hits between points, nor a pass', () => {
    const view = { cssSize: 560, boardSize: 19 };
    const g = boardGeometry(560, 19);
    const discs = [
      disc(1, { type: 'play', x: 3, y: 3 }),
      disc(2, { type: 'play', x: 4, y: 3 }),
      disc(3, { type: 'pass' }),
    ];
    expect(candidateAt((g.lines[3] + g.lines[4]) / 2, g.lines[3], view, discs)).toBeNull();
    expect(candidateAt(0, 0, view, discs)).toBeNull();
    expect(candidateAt(-5, 1000, view, discs)).toBeNull();
  });
});
