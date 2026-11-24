import { expect, it } from 'vitest';
import { formatResult, parseResult } from './ResultField';

it.each([
  [null, { winner: 'none', by: null }],
  ['0', { winner: 'draw', by: null }],
  ['B+2.5', { winner: 'black', by: { points: 2.5 } }],
  ['W+R', { winner: 'white', by: 'resign' }],
  ['B+T', { winner: 'black', by: 'time' }],
  ['B+F', { winner: 'black', by: 'forfeit' }],
  ['Void', { raw: 'Void' }],
  ['B+', { raw: 'B+' }],
  ['W+-1', { raw: 'W+-1' }],
] as const)('parses and formats %s', (input, want) => {
  const parsed = parseResult(input);
  expect(parsed).toEqual(want);
  expect(formatResult(parsed)).toBe(input);
});
