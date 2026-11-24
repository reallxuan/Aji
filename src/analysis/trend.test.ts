import { describe, expect, it } from 'vitest';
import type { Color } from '../transport/generated/Color';
import type { TrendNode } from '../transport/generated/TrendNode';
import { barTexts, plotRuns, scoreRange } from './trend';

/** Nodes from [winrate, lead, visits] triples (null for none), movers alternating from Black. */
function nodes(
  stats: Array<[number, number, number] | null>,
  movers: Array<Color | null> = stats.map((_, i) => (i === 0 ? null : i % 2 ? 'black' : 'white')),
): TrendNode[] {
  return stats.map((s, i) => ({
    node: i,
    key: i.toString(16).padStart(16, '0'),
    moveNumber: i,
    tryout: false,
    toPlay: i % 2 ? 'white' : 'black',
    mover: movers[i],
    move: movers[i] ? { type: 'play', x: i % 19, y: 0 } : null,
    stats: s && { winrate: s[0], scoreLead: s[1], visits: s[2] },
    loss: null,
  }));
}

describe('plotRuns', () => {
  it('breaks at gaps and at too few visits', () => {
    const line = nodes([
      [0.5, 0, 100],
      [0.5, 0, 100],
      null,
      [0.5, 0, 100],
      [0.5, 0, 49],
      [0.5, 0, 50],
      [0.5, 0, 50],
    ]);
    expect(plotRuns(line)).toEqual([[0, 1], [3], [5, 6]]);
    expect(plotRuns([])).toEqual([]);
  });
});

describe('scoreRange', () => {
  it('takes the first range that holds every plotted lead', () => {
    expect(scoreRange(nodes([[0.5, 9.9, 100]]))).toBe(10);
    expect(scoreRange(nodes([[0.5, -10, 100]]))).toBe(10);
    expect(scoreRange(nodes([[0.5, 10.1, 100]]))).toBe(20);
    expect(scoreRange(nodes([[0.5, -95, 100]]))).toBe(160);
    expect(scoreRange(nodes([[0.5, 300, 100]]))).toBe(160);
    // An unplotted node does not widen the range.
    expect(
      scoreRange(
        nodes([
          [0.5, 1, 100],
          [0.5, 50, 10],
        ]),
      ),
    ).toBe(10);
    expect(scoreRange([])).toBe(10);
  });
});

describe('barTexts', () => {
  const labels = {
    percent: (x: number) => `${(x * 100).toFixed(1)}%`,
    lead: (points: number) => `lead ${points.toFixed(1)}`,
    even: () => 'even',
  };
  const measure = (text: string) => text.length * 7;

  it('puts the lead in the leader’s segment', () => {
    expect(barTexts(0.69, 3.5, { black: 340, white: 152 }, measure, labels)).toEqual({
      black: ['69.0%', 'lead 3.5'],
      white: ['31.0%'],
    });
    expect(barTexts(0.382, -2.1, { black: 188, white: 304 }, measure, labels)).toEqual({
      black: ['38.2%'],
      white: ['lead 2.1', '61.8%'],
    });
  });

  it('hides the lead when it does not fit', () => {
    // 5 + 8 characters at 7 px plus three paddings of 9 px: 118 px.
    expect(barTexts(0.6, 3.5, { black: 117, white: 78 }, measure, labels).black).toEqual(['60.0%']);
    expect(barTexts(0.6, 3.5, { black: 118, white: 78 }, measure, labels).black).toEqual([
      '60.0%',
      'lead 3.5',
    ]);
  });

  it('reads an even lead as even, beside the side ahead on win rate', () => {
    expect(barTexts(0.5, 0.04, { black: 300, white: 300 }, measure, labels)).toEqual({
      black: ['50.0%', 'even'],
      white: ['50.0%'],
    });
    expect(barTexts(0.45, -0.02, { black: 270, white: 330 }, measure, labels)).toEqual({
      black: ['45.0%'],
      white: ['even', '55.0%'],
    });
  });

  it('hides a percentage its segment cannot hold', () => {
    expect(barTexts(0.995, 30, { black: 490, white: 2 }, measure, labels).white).toEqual([]);
  });
});
