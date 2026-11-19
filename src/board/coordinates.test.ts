import { createI18n } from '../i18n/createI18n';
import { moveLabel, pointLabel } from './coordinates';

it('formats points like GTP', () => {
  expect(pointLabel({ x: 0, y: 0 }, 19)).toBe('A19');
  expect(pointLabel({ x: 18, y: 18 }, 19)).toBe('T1');
  expect(pointLabel({ x: 8, y: 0 }, 19)).toBe('J19');
  expect(pointLabel({ x: 15, y: 3 }, 19)).toBe('Q16');
  expect(pointLabel({ x: 4, y: 4 }, 9)).toBe('E5');
});

it('formats moves, with a translated pass', () => {
  const t = createI18n('en').t;
  expect(moveLabel({ type: 'play', x: 15, y: 3 }, 19, t)).toBe('Q16');
  expect(moveLabel({ type: 'pass' }, 19, t)).toBe('Pass');
  expect(moveLabel({ type: 'pass' }, 19, createI18n('zh-CN').t)).toBe('停一手');
});
