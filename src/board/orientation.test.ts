import { expect, it } from 'vitest';
import {
  flipH,
  flipV,
  fromView,
  rotateCcw,
  rotateCw,
  toView,
  type Orientation,
} from './orientation';
import { marginLabels } from './coordinates';
import { boardGeometry, pointAt } from './geometry';

it('orientation round trips every point and composes rotations and flips in screen space', () => {
  const results = new Set<string>();
  for (const o of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
    results.add(JSON.stringify(toView({ x: 1, y: 2 }, 19, o)));
    expect(rotateCcw(rotateCw(o))).toBe(o);
    for (let x = 0; x < 19; x++) {
      for (let y = 0; y < 19; y++) {
        const p = { x, y };
        const v = toView(p, 19, o);
        expect(fromView(v, 19, o)).toEqual(p);
        expect(toView(p, 19, rotateCw(o))).toEqual({ x: 18 - v.y, y: v.x });
        expect(toView(p, 19, flipH(o))).toEqual({ x: 18 - v.x, y: v.y });
        expect(toView(p, 19, flipV(o))).toEqual({ x: v.x, y: 18 - v.y });
      }
    }
  }
  expect(results.size).toBe(8);
});

it('labels follow their lines and clicks return logical points', () => {
  const { lines } = boardGeometry(400, 19);
  const view = { cssSize: 400, boardSize: 19, orientation: 1 as Orientation };
  expect(pointAt(lines[15], lines[15], view)).toEqual({ x: 15, y: 3 });
  expect(marginLabels(15, 19, 1)).toEqual({ top: '16', left: 'Q' });
  expect(marginLabels(0, 19, 1)).toEqual({ top: '1', left: 'A' });
});
