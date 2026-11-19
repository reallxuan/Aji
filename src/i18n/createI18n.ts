import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';
import type { Language } from './language';

/** A fresh, initialised i18next instance, so tests and the app never share global state. */
export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  // The lang attribute makes the system's fallback fonts pick Simplified Chinese glyphs.
  document.documentElement.lang = language;
  return instance;
}
