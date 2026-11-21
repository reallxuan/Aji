import { expect, it } from 'vitest';
import { boardLead } from './lead';

it('board_lead_adds_komi_for_black_and_subtracts_for_white', () => {
  // KataGo's lead counts komi; the board count leaves it out (design 5.10).
  expect(boardLead(-2, 7.5, 'black')).toBe(5.5);
  expect(boardLead(2, 7.5, 'white')).toBe(-5.5);
  expect(boardLead(0, 6.5, 'white')).toBe(-6.5);
  expect(boardLead(1, -0.5, 'black')).toBe(0.5);
});
