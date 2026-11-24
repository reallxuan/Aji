import type { Point } from '../transport/generated/Point';

/** Low two bits are clockwise quarter turns, applied after an optional horizontal reflection. */
export type Orientation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function toView(p: Point, size: number, o: Orientation): Point {
  const far = size - 1;
  const x = o >= 4 ? far - p.x : p.x;
  switch (o % 4) {
    case 1:
      return { x: far - p.y, y: x };
    case 2:
      return { x: far - x, y: far - p.y };
    case 3:
      return { x: p.y, y: far - x };
    default:
      return { x, y: p.y };
  }
}

export function fromView(p: Point, size: number, o: Orientation): Point {
  // Every reflection is its own inverse.
  return toView(p, size, o >= 4 ? o : (((4 - o) % 4) as Orientation));
}

export const rotateCw = (o: Orientation) => ((o & 4) | ((o + 1) % 4)) as Orientation;
export const rotateCcw = (o: Orientation) => ((o & 4) | ((o + 3) % 4)) as Orientation;
export const flipH = (o: Orientation) => (((o ^ 4) & 4) | ((8 - o) % 4)) as Orientation;
export const flipV = (o: Orientation) => rotateCw(rotateCw(flipH(o)));
