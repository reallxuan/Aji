import type { Color } from '../transport/generated/Color';
import type { Move } from '../transport/generated/Move';
import type { Point } from '../transport/generated/Point';
import { MAX_VARIATION } from './constants';

/** A hovered candidate's line, frozen when the hover began (design 5.8). */
export interface Variation {
  moves: Move[];
  /** Who plays each move, from the side to move on. */
  colors: Color[];
  /** The points each move captured, from the backend's preview. */
  captured: Point[][];
  /** The first move the rules refuse; it and the moves after it are not shown. */
  illegalAt: number | null;
}

/** At most `max` moves of a principal variation (the device's line length), cut before its first pass. */
export function linePrefix(pv: readonly Move[], max: number = MAX_VARIATION): Move[] {
  const pass = pv.findIndex((m) => m.type === 'pass');
  return pv.slice(0, Math.min(pass < 0 ? pv.length : pass, max));
}

/** How many moves of the line can be shown. */
export function shownLength(v: Variation): number {
  return v.illegalAt ?? v.moves.length;
}

export interface VariationBoard {
  stones: (Color | null)[];
  /** Each line stone still on the board, with its move number: a point played twice keeps the later one. */
  numbers: Array<{ point: Point; n: number }>;
  /** The newest stone of a partial line, which gets a bold number and a ring. */
  newest: Point | null;
}

/** `base` with moves 1 to `step` of the line played on it, each removing what it captured. */
export function variationBoard(
  base: readonly (Color | null)[],
  size: number,
  v: Variation,
  step: number,
): VariationBoard {
  const stones = [...base];
  const numbered = new Map<number, number>();
  const length = shownLength(v);
  const shown = Math.max(0, Math.min(step, length));
  let newest: Point | null = null;
  for (let i = 0; i < shown; i++) {
    const move = v.moves[i];
    if (move.type !== 'play') continue;
    const at = move.y * size + move.x;
    stones[at] = v.colors[i];
    numbered.set(at, i + 1);
    for (const p of v.captured[i] ?? []) {
      stones[p.y * size + p.x] = null;
      numbered.delete(p.y * size + p.x);
    }
    newest = { x: move.x, y: move.y };
  }
  const numbers = [...numbered]
    .sort((a, b) => a[1] - b[1])
    .map(([at, n]) => ({ point: { x: at % size, y: Math.floor(at / size) }, n }));
  return { stones, numbers, newest: shown < length ? newest : null };
}
