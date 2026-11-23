import type { Color } from '../transport/generated/Color';
import type { Point } from '../transport/generated/Point';

/** The stones joined to the one at `at` (row by row, `size` lines a side); empty on an empty point. */
export function groupAt(stones: readonly (Color | null)[], size: number, at: Point): Point[] {
  const color = stones[at.y * size + at.x];
  if (!color || at.x < 0 || at.y < 0 || at.x >= size || at.y >= size) return [];
  const seen = new Set([at.y * size + at.x]);
  const out: Point[] = [];
  const stack = [at];
  while (stack.length) {
    const p = stack.pop()!;
    out.push(p);
    for (const [dx, dy] of STEPS) {
      const q = { x: p.x + dx, y: p.y + dy };
      const i = q.y * size + q.x;
      if (q.x < 0 || q.y < 0 || q.x >= size || q.y >= size || seen.has(i)) continue;
      if (stones[i] !== color) continue;
      seen.add(i);
      stack.push(q);
    }
  }
  return out;
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Whether `a` and `b` hold the same points, in any order. */
export function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p) => b.some((q) => samePoint(p, q)));
}
