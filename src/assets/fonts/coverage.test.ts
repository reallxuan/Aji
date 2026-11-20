import codepoints from './wenkai-codepoints.json';
import zhCN from '../../locales/zh-CN.json';

/** Every string value in a nested locale object. */
function values(tree: unknown): string[] {
  if (typeof tree === 'string') return [tree];
  if (tree && typeof tree === 'object') return Object.values(tree).flatMap(values);
  return [];
}

const covered = new Set<number>(codepoints.regular);
const coveredMedium = new Set<number>(codepoints.medium);

it('the WenKai subset covers every character of the zh-CN locale', () => {
  const missing = new Set<string>();
  for (const text of values(zhCN)) {
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (code < 0x80) continue;
      if (!covered.has(code) || !coveredMedium.has(code)) missing.add(char);
    }
  }
  expect([...missing].join('')).toBe('');
});

it('the subset is a subset: a rare character outside GB2312 is left out', () => {
  expect(covered.has('𠀀'.codePointAt(0)!)).toBe(false);
  expect(covered.has('围'.codePointAt(0)!)).toBe(true);
});
