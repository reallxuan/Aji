import { useEffect } from 'react';
import {
  applyTheme,
  DARK_QUERY,
  LIGHT_QUERY,
  readSystemTheme,
  resolveTheme,
  type ThemePreference,
} from './theme';

/** Applies `preference`, and while it is 'system', follows the OS as it changes. */
export function useThemeSync(preference: ThemePreference): void {
  useEffect(() => {
    const matchMedia = window.matchMedia?.bind(window);
    const sync = () => applyTheme(resolveTheme(preference, readSystemTheme(matchMedia)));
    sync();
    if (!matchMedia || preference !== 'system') return;
    const queries = [matchMedia(DARK_QUERY), matchMedia(LIGHT_QUERY)];
    queries.forEach((query) => query.addEventListener('change', sync));
    return () => queries.forEach((query) => query.removeEventListener('change', sync));
  }, [preference]);
}
