import { describe, expect, it } from 'vitest';
import { boardGeometry } from './geometry';

const letters = (n: number) => boardGeometry(868, n).columns.map((c) => c.label);

/** The point label (as in D4) of each star, from its line indices. */
function starNames(n: number): string[] {
  const g = boardGeometry(868, n);
  const cols = letters(n);
  return g.stars.map(([col, row]) => `${cols[col]}${n - row}`).sort();
}

describe('boardGeometry', () => {
  it('labels 19×19 columns A to T without I, and rows 19 to 1 from the top', () => {
    const g = boardGeometry(868, 19);
    expect(letters(19).join('')).toBe('ABCDEFGHJKLMNOPQRST');
    expect(g.rows.map((r) => r.label)).toEqual(
      Array.from({ length: 19 }, (_, i) => String(19 - i)),
    );
    expect(g.rows[0].y).toBeLessThan(g.rows[18].y);
  });

  it('puts the nine 19×19 star points on the 4-4, 4-10 and 10-10 points', () => {
    expect(starNames(19)).toEqual(['D10', 'D16', 'D4', 'K10', 'K16', 'K4', 'Q10', 'Q16', 'Q4']);
  });

  it('gives 13×13 and 9×9 five star points each', () => {
    expect(starNames(13)).toEqual(['D10', 'D4', 'G7', 'K10', 'K4']);
    expect(starNames(9)).toEqual(['C3', 'C7', 'E5', 'G3', 'G7']);
  });

  it('keeps every line inside the board', () => {
    for (const n of [9, 13, 19]) {
      for (const size of [120, 500, 868]) {
        const g = boardGeometry(size, n);
        expect(g.lines).toHaveLength(n);
        for (const line of g.lines) {
          expect(line).toBeGreaterThan(0);
          expect(line).toBeLessThan(size);
        }
      }
    }
  });

  it('matches the mockup at 868 px: grid from 40 to 828, spacing about 43.8', () => {
    const g = boardGeometry(868, 19);
    expect(g.lines[0]).toBeCloseTo(40, 0);
    expect(g.lines[18]).toBeCloseTo(828, 0);
    expect(Math.abs(g.spacing - 788 / 18)).toBeLessThan(1);
  });

  it('returns no lines for an empty board area', () => {
    const g = boardGeometry(0, 19);
    expect(g.spacing).toBe(0);
  });
});
