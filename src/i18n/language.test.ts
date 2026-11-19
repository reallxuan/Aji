import { resolveLanguage } from './language';

it.each([
  ['system', ['zh-CN'], 'zh-CN'],
  ['system', ['zh-Hans-CN'], 'zh-CN'],
  ['system', ['zh-TW'], 'zh-CN'], // until a Traditional Chinese locale exists
  ['system', ['ZH-cn'], 'zh-CN'],
  ['system', ['en-GB', 'zh-CN'], 'en'],
  ['system', ['ja-JP', 'zh-CN'], 'zh-CN'],
  ['system', ['ja-JP'], 'en'],
  ['system', [], 'en'],
  ['en', ['zh-CN'], 'en'],
  ['zh-CN', ['en-US'], 'zh-CN'],
] as const)('resolveLanguage(%s, %j) is %s', (pref, locales, expected) => {
  expect(resolveLanguage(pref, locales)).toBe(expected);
});
