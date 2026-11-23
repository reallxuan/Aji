import { expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { tagText } from './labels';

it('lists a backend’s tags with the language’s comma, never a middle dot', () => {
  expect(tagText(createI18n('zh-CN').t, ['fastest', 'noRuntimeDownload'])).toBe('最快，免运行库');
  expect(tagText(createI18n('en').t, ['fastest', 'cpuOnly'])).toMatch(/^\S.*, \S/);
});
