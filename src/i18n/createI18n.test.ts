import { createI18n } from './createI18n';

it('translates in the requested language', () => {
  expect(createI18n('zh-CN').t('os.other')).toBe('未知系统');
  expect(createI18n('en').t('os.other')).toBe('Unknown system');
});

it('sets the document language so fallback fonts pick the right glyphs', () => {
  createI18n('zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN');
  createI18n('en');
  expect(document.documentElement.lang).toBe('en');
});
