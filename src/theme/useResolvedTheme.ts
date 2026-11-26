import { useSyncExternalStore } from 'react';
import type { Theme } from './theme';

/** The theme the window is drawn in: `applyTheme`'s `data-theme`, dark until one is set. */
export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  return root.dataset.theme === 'light' ? 'light' : 'dark';
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/**
 * The resolved theme, following `<html data-theme>` as `useThemeSync` changes it, so a part that
 * depends on the theme (the board chosen for it, dark boards design) redraws when it switches.
 */
export function useResolvedTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => currentTheme(),
    () => 'dark',
  );
}
