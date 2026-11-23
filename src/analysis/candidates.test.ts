import { expect, it } from 'vitest';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { Candidate } from '../transport/generated/Candidate';
import type { Move } from '../transport/generated/Move';
import { catchingUp, nextRingPoint, shownCandidates, tierFor } from './candidates';

const update = (rootVisits: number, previousVisits: number): AnalysisUpdate => ({
  position: 'aaaaaaaaaaaaaaaa',
  boardSize: 19,
  rootVisits,
  winrate: 0.5,
  scoreLead: 0,
  isFinal: false,
  candidates: [],
  previousVisits,
  ownership: null,
  next: null,
});

it('catching up compares previous visits', () => {
  expect(catchingUp(update(640, 1000))).toBe(true);
  expect(catchingUp(update(1000, 1000))).toBe(false);
  expect(catchingUp(update(10, 0))).toBe(false);
});

const play = (x: number, y = 0): Move => ({ type: 'play', x, y });

function candidate(order: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    move: play(order),
    order,
    visits: 1000 - order,
    winrate: 0.5,
    scoreLead: 0,
    prior: 0.1,
    pv: [play(order), play(order, 1)],
    ...overrides,
  };
}

const withCandidates = (candidates: Candidate[]): AnalysisUpdate => ({
  ...update(5000, 0),
  candidates,
});

it('keeps at most ten, each with two percent of the top visits', () => {
  const many = Array.from({ length: 14 }, (_, i) => candidate(i));
  expect(shownCandidates(withCandidates(many), 'black', null, 'black')).toHaveLength(10);
  const thin = [
    candidate(0, { visits: 1000 }),
    candidate(1, { visits: 20 }),
    candidate(2, { visits: 19 }),
  ];
  const shown = shownCandidates(withCandidates(thin), 'black', null, 'black');
  expect(shown.map((c) => c.rank)).toEqual([1, 2]);
});

it('the count is today’s rule, a fixed number of KataGo’s first, or all', () => {
  const many = Array.from({ length: 14 }, (_, i) => candidate(i, { visits: i ? 10 : 1000 }));
  const count = (n: Parameters<typeof shownCandidates>[5], next: Move | null = null) =>
    shownCandidates(withCandidates(many), 'black', next, 'black', null, n).map((c) => c.rank);
  // Auto: the two-percent rule leaves only the first.
  expect(count('auto')).toEqual([1]);
  expect(count(5)).toEqual([1, 2, 3, 4, 5]);
  expect(count(10)).toHaveLength(10);
  expect(count('all')).toHaveLength(14);
  // The played move still joins.
  expect(count(5, play(12))).toEqual([1, 2, 3, 4, 5, 6]);
});

it('adds the played move below the threshold', () => {
  const thin = [candidate(0, { visits: 1000 }), candidate(1, { visits: 5 })];
  const shown = shownCandidates(withCandidates(thin), 'black', play(1), 'black');
  expect(shown.map((c) => c.move)).toEqual([play(0), play(1)]);
  expect(shown[1]).toMatchObject({ rank: 2, played: true });
  // A played move KataGo did not report is not invented.
  expect(shownCandidates(withCandidates(thin), 'black', play(9), 'black')).toHaveLength(1);
});

it('white to move, in White’s perspective, flips win rate and lead', () => {
  const shown = shownCandidates(
    withCandidates([
      candidate(0, { winrate: 0.458, scoreLead: -1.5 }),
      candidate(1, { winrate: 0.478, scoreLead: -0.8 }),
    ]),
    'white',
    null,
    'white',
  );
  expect(shown[0].winrate).toBeCloseTo(0.542);
  expect(shown[0].scoreLead).toBeCloseTo(1.5);
  expect(shown[0].tier).toBe('best');
  // White's best is Black's lowest win rate: the second loses two points for White.
  expect(shown[1].loss).toBeCloseTo(2);
  expect(shown[1].tier).toBe('doubtful');
});

it('tiers at two and four', () => {
  expect(tierFor(0, true)).toBe('best');
  expect(tierFor(1.99, false)).toBe('close');
  expect(tierFor(2, false)).toBe('doubtful');
  expect(tierFor(4, false)).toBe('doubtful');
  expect(tierFor(4.01, false)).toBe('poor');
});

it('marks the played move', () => {
  const shown = shownCandidates(
    withCandidates([candidate(0), candidate(1), candidate(2)]),
    'black',
    play(2),
    'black',
  );
  expect(shown.map((c) => c.played)).toEqual([false, false, true]);
  expect(
    shownCandidates(withCandidates([candidate(0)]), 'black', { type: 'pass' }, 'black')[0].played,
  ).toBe(false);
});

it('shows the chosen side’s numbers, and rates each move for the side to move', () => {
  const update = withCandidates([
    candidate(0, { winrate: 0.542, scoreLead: 1.8 }),
    candidate(1, { winrate: 0.511, scoreLead: 0.4 }),
  ]);
  const black = shownCandidates(update, 'black', null, 'black');
  const white = shownCandidates(update, 'black', null, 'white');
  expect(black[0].winrate).toBeCloseTo(0.542);
  expect(white[0].winrate).toBeCloseTo(0.458);
  expect(white[0].scoreLead).toBeCloseTo(-1.8);
  // Black's second move loses 3.1 points for Black, whoever is watching.
  expect(white.map((c) => [c.tier, c.loss])).toEqual(black.map((c) => [c.tier, c.loss]));
  expect(white[1].tier).toBe('doubtful');
});

const NEXT = {
  stats: { winrate: 0.52, scoreLead: 0.5, visits: 300 },
  loss: { winrate: 5, score: 1.5 },
};
const LISTED = [candidate(0, { visits: 1000 }), candidate(1, { visits: 500 })];

it('unlisted_next_move_gets_a_disc_with_the_ring', () => {
  const shown = shownCandidates(
    { ...withCandidates(LISTED), next: NEXT },
    'black',
    play(9),
    'black',
  );
  expect(shown).toHaveLength(3);
  // The next position's result, its tier from its loss, and the played ring.
  expect(shown[2]).toEqual({
    move: play(9),
    rank: 3,
    tier: 'poor',
    winrate: 0.52,
    scoreLead: 0.5,
    visits: 300,
    loss: 5,
    played: true,
    pv: [play(9)],
  });
  // In the side to move's view.
  const white = shownCandidates(
    { ...withCandidates(LISTED), next: NEXT },
    'white',
    play(9),
    'white',
  );
  expect(white[2]).toMatchObject({ winrate: 0.48, scoreLead: -0.5 });
  // On tierFor's 2 and 4 point bands.
  const tier = (winrate: number) =>
    shownCandidates(
      { ...withCandidates(LISTED), next: { ...NEXT, loss: { winrate, score: 0 } } },
      'black',
      play(9),
      'black',
    )[2].tier;
  expect([tier(1.5), tier(3), tier(4.5)]).toEqual(['close', 'doubtful', 'poor']);
  // No result for it yet: no disc.
  expect(shownCandidates(withCandidates(LISTED), 'black', play(9), 'black')).toHaveLength(2);
});

it('without_a_result_it_is_a_ring_alone', () => {
  const discs = shownCandidates(withCandidates(LISTED), 'black', play(9), 'black');
  expect(nextRingPoint(play(9), true, discs, false)).toEqual({ x: 9, y: 0 });
  // Among the discs, the disc has the ring.
  expect(nextRingPoint(play(1), true, discs, false)).toBeNull();
  // A pass has no point, and a hovered line has the board.
  expect(nextRingPoint({ type: 'pass' }, true, discs, false)).toBeNull();
  expect(nextRingPoint(play(9), true, discs, true)).toBeNull();
  expect(nextRingPoint(null, true, discs, false)).toBeNull();
});

it('hidden_candidates_leave_the_ring', () => {
  // F or Z: no discs drawn, so even a listed next move is a ring alone.
  expect(nextRingPoint(play(1), true, [], false)).toEqual({ x: 1, y: 0 });
});

it('the_setting_hides_both', () => {
  expect(nextRingPoint(play(9), false, [], false)).toBeNull();
});
