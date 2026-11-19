export type Theme = 'dark' | 'light';
export type ThemePreference = 'system' | Theme;

export const DARK_QUERY = '(prefers-color-scheme: dark)';
export const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Dark is the fallback when the system preference cannot be read (interface design, section 2). */
export function resolveTheme(preference: ThemePreference, system: Theme | null): Theme {
  return preference === 'system' ? (system ?? 'dark') : preference;
}

export function readSystemTheme(
  matchMedia: ((query: string) => { matches: boolean }) | undefined,
): Theme | null {
  if (!matchMedia) return null;
  if (matchMedia(DARK_QUERY).matches) return 'dark';
  if (matchMedia(LIGHT_QUERY).matches) return 'light';
  return null;
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}
