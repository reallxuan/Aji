import { useEffect } from 'react';
import { applyTheme, DARK_QUERY, LIGHT_QUERY, readSystemTheme, resolveTheme } from './theme';

/** Keeps the document theme in step with the OS. The preference is fixed to 'system' until settings exist. */
export function useThemeSync(): void {
  useEffect(() => {
    const matchMedia = window.matchMedia?.bind(window);
    const sync = () => applyTheme(resolveTheme('system', readSystemTheme(matchMedia)));
    sync();
    if (!matchMedia) return;
    const queries = [matchMedia(DARK_QUERY), matchMedia(LIGHT_QUERY)];
    queries.forEach((query) => query.addEventListener('change', sync));
    return () => queries.forEach((query) => query.removeEventListener('change', sync));
  }, []);
}
