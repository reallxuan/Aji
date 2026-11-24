import type { Placed } from '../transport/generated/Placed';
import type { MoveNumbers } from '../device/deviceSettings';

export function numbersFor(
  placed: readonly Placed[],
  lastMoveNumber: number,
  settings: MoveNumbers,
) {
  if (settings.mode === 'off') return [];
  return placed.flatMap(({ point, number, branchNumber }) => {
    if (settings.mode === 'last' && number <= lastMoveNumber - settings.last) return [];
    const n = settings.restartInBranch ? branchNumber : number;
    return n === null ? [] : [{ point, n }];
  });
}
