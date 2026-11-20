import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveLanguage } from '../i18n/language';
import { useThemeSync } from '../theme/useThemeSync';
import { getSettings } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { useSettingsStore } from './settingsStore';

/**
 * Loads the stored settings, follows `settingsChanged`, and keeps the interface language and the
 * theme in step with them. Until the settings arrive, both follow the system.
 */
export function useSettingsSync(): void {
  const transport = useTransport();
  const { i18n } = useTranslation();
  const language = useSettingsStore((state) => state.settings?.language ?? 'system');
  const theme = useSettingsStore((state) => state.settings?.theme ?? 'system');

  useEffect(() => {
    let active = true;
    const { apply } = useSettingsStore.getState();
    // Subscribe first, so a change made while the first request is in flight is not lost.
    const unsubscribe = transport.subscribe((event) => {
      if (active && event.type === 'settingsChanged') apply(event.settings);
    });
    getSettings(transport).then(
      (settings) => {
        if (active) apply(settings);
      },
      () => {
        // The defaults stay in effect; the settings page shows the error if the user opens it.
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [transport]);

  useEffect(() => {
    const resolved = resolveLanguage(language, navigator.languages);
    if (i18n.language !== resolved) void i18n.changeLanguage(resolved);
    document.documentElement.lang = resolved;
  }, [i18n, language]);

  useThemeSync(theme);
}
