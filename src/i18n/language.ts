export type Language = 'zh-CN' | 'en';
export type LanguagePreference = 'system' | Language;

/**
 * An explicit preference wins. Otherwise the first system locale whose language Aji ships decides:
 * any Chinese locale maps to zh-CN until a Traditional Chinese locale exists. English is the fallback.
 */
export function resolveLanguage(
  preference: LanguagePreference,
  systemLocales: readonly string[],
): Language {
  if (preference !== 'system') return preference;
  for (const locale of systemLocales) {
    const language = locale.split(/[-_]/)[0].toLowerCase();
    if (language === 'zh') return 'zh-CN';
    if (language === 'en') return 'en';
  }
  return 'en';
}
