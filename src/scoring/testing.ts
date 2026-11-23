import type { Color } from '../transport/generated/Color';
import type { Point } from '../transport/generated/Point';

/** The final-scoring mockup's finished 9×9 game: KataGo reads White C5 and Black H4 as dead. */
export const FINISHED_9 = [
  '...XO....',
  '...XO....',
  '...XO....',
  '..XXOO...',
  '..OXXO...',
  '....XOOX.',
  '...XXXO..',
  '...XOOO..',
  '...XO....',
];
export const C5: Point = { x: 2, y: 4 };
export const H4: Point = { x: 7, y: 5 };

export const finishedStones = (): (Color | null)[] =>
  FINISHED_9.flatMap((row) =>
    [...row].map((c) => (c === 'X' ? 'black' : c === 'O' ? 'white' : null)),
  );
