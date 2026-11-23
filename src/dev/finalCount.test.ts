import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '../game/testing';
import { C5, finishedStones, H4 } from '../scoring/testing';
import { finalCount } from './finalCount';

describe('the scenarios’ final count', () => {
  const game = makeSnapshot({ size: 9, stones: finishedStones(), captures: [2, 3] });

  it('counts the mockup game by area with C5 and H4 dead', () => {
    const score = finalCount(game, [C5, H4]);
    expect(score.black).toEqual({ stones: 13, territory: 26, dead: 1, prisoners: 2, total: 40 });
    expect(score.white.total).toBe(48.5);
    expect(score.margin).toBe(-8.5);
    expect(score.suggestedDead).toEqual([C5, H4]);
  });

  it('counts territory under Japanese rules', () => {
    const rules = { kind: 'japaneseKorean' } as const;
    const score = finalCount({ ...game, rules: { ...game.rules, current: rules } }, [C5, H4]);
    expect([score.black.total, score.white.total]).toEqual([30, 38.5]);
  });
});
