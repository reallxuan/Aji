import { fromView, type Orientation } from './orientation';
import type { TFunction } from 'i18next';
import type { Move } from '../transport/generated/Move';
import type { Point } from '../transport/generated/Point';

// GTP columns skip the letter I.
const COLUMNS = 'ABCDEFGHJKLMNOPQRST';

/** A point in GTP style: column letter, then the row counted from the bottom ("Q16"). */
export function pointLabel(point: Point, size: number): string {
  return `${COLUMNS[point.x] ?? '?'}${size - point.y}`;
}

/** A move label; a pass is translated, so the caller passes the `t` function. */
export function moveLabel(move: Move, size: number, t: TFunction): string {
  return move.type === 'pass' ? t('analysis.pass') : pointLabel(move, size);
}

/** Labels on the top and left margins for a displayed line index. */
export function marginLabels(index: number, size: number, orientation: Orientation) {
  const { x, y } = fromView({ x: index, y: index }, size, orientation);
  const column = COLUMNS[x] ?? '';
  const row = String(size - y);
  return orientation % 2 ? { top: row, left: column } : { top: column, left: row };
}
