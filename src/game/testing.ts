import type { GameInfo } from '../transport/generated/GameInfo';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';

export const noInfo: GameInfo = {
  black: null,
  white: null,
  blackRank: null,
  whiteRank: null,
  result: null,
  date: null,
  event: null,
  round: null,
  gameName: null,
  place: null,
  handicap: null,
};

/** A snapshot of an empty 19×19 game at revision 1, with `over` applied. For tests and scenarios. */
export function makeSnapshot(over: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    revision: 1,
    name: null,
    info: noInfo,
    rules: {
      current: { kind: 'chinese' },
      fromFile: { kind: 'chinese' },
      changed: false,
      ru: null,
      km: null,
    },
    size: 19,
    stones: Array.from({ length: 361 }, () => null),
    lastMove: null,
    nextColor: 'black',
    moveNumber: 0,
    lineIndex: 0,
    nextMove: null,
    mainLineLength: 0,
    atStart: true,
    atEnd: true,
    illegal: null,
    captures: [0, 0],
    positionKey: '00000000000000aa',
    hasMoves: false,
    ...over,
  };
}
