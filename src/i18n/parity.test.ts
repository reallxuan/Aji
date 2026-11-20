import en from '../locales/en.json';
import zh from '../locales/zh-CN.json';

type Tree = { [key: string]: unknown };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (value && typeof value === 'object') Object.assign(out, flatten(value as Tree, path));
    else throw new Error(`${path} is neither a string nor a nested object`);
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
}

const locales = { 'zh-CN': flatten(zh), en: flatten(en) };

it('both locales have the same keys', () => {
  expect(Object.keys(locales['zh-CN']).sort()).toEqual(Object.keys(locales.en).sort());
});

it('no value is empty', () => {
  for (const [lang, strings] of Object.entries(locales)) {
    for (const [key, value] of Object.entries(strings)) {
      expect(value.trim(), `${lang}: ${key}`).not.toBe('');
    }
  }
});

it('each key uses the same placeholders in both locales', () => {
  for (const [key, value] of Object.entries(locales.en)) {
    expect(placeholders(locales['zh-CN'][key] ?? ''), key).toEqual(placeholders(value));
  }
});

// Language names are endonyms: each language is named in itself, whatever the interface language.
const ENDONYMS = 'languageName.';

it('English text contains no Chinese characters', () => {
  for (const [key, value] of Object.entries(locales.en)) {
    if (key.startsWith(ENDONYMS)) continue;
    expect(/[㐀-鿿]/.test(value), key).toBe(false);
  }
});
