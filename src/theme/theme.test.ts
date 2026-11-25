import css from '../styles/theme.css?raw';
import { applyTheme, readSystemTheme, resolveTheme } from './theme';

function tokens(theme: 'dark' | 'light'): Record<string, string> {
  const block =
    css.match(new RegExp(`:root\\[data-theme=['"]${theme}['"]\\]\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  // Prettier may lower-case hex colours, so compare in upper case.
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toUpperCase()]),
  );
}

it('defines the dark tokens from the interface design', () => {
  expect(tokens('dark')).toEqual({
    ground: '#161618',
    panel: '#1E1E21',
    hairline: '#303035',
    'divider-soft': '#28282C',
    text: '#ECEAE4',
    'text-muted': '#A3A19A',
    line: '#5A5A61',
    score: '#E3A548',
    'engine-ok': '#1E8E5A',
    'engine-error': '#E5484D',
    // The win-rate bar and small cards (M7 mockups).
    'bar-black': '#050506',
    'bar-white': '#F4F2EC',
    'bar-edge': '#3A3A40',
    pop: '#2A2A2E',
  });
});
it('defines the light tokens from the interface design', () => {
  expect(tokens('light')).toEqual({
    ground: '#E3E3E0',
    panel: '#F5F5F3',
    hairline: '#D6D6D2',
    'divider-soft': '#E6E6E2',
    text: '#1D1D1B',
    'text-muted': '#5E5E5A',
    line: '#A3A39E',
    score: '#B26A00',
    'engine-ok': '#1E8E5A',
    'engine-error': '#C62828',
    'bar-black': '#1D1D1B',
    'bar-white': '#FFFFFF',
    'bar-edge': '#C9C9C4',
    pop: '#FFFFFF',
  });
});
it('defines the dark tokens as the default before a theme is set', () => {
  expect(css).toMatch(/:root,\s*:root\[data-theme='dark'\]\s*\{/);
});
it('gives a wood board a shadow in each theme (UI polish design 3)', () => {
  expect(css).toMatch(/:root,\s*:root\[data-theme='dark'\]\s*\{\s*--board-shadow:[^;]+;/);
  expect(css).toMatch(/:root\[data-theme='light'\]\s*\{\s*--board-shadow:[^;]+;/);
});
it('defines the board base colour once for both themes', () => {
  expect(css).toMatch(/:root\s*\{[^}]*--board-base:\s*#DDB067;/i);
});
it.each([
  ['system', 'light', 'light'],
  ['system', 'dark', 'dark'],
  ['system', null, 'dark'],
  ['light', 'dark', 'light'],
  ['dark', null, 'dark'],
] as const)('resolveTheme(%s, %s) is %s', (pref, system, expected) => {
  expect(resolveTheme(pref, system)).toBe(expected);
});
it('reads the system theme, and null when no preference is readable', () => {
  const mm = (dark: boolean, light: boolean) => (q: string) => ({
    matches: q.includes('dark') ? dark : light,
  });
  expect(readSystemTheme(mm(true, false))).toBe('dark');
  expect(readSystemTheme(mm(false, true))).toBe('light');
  expect(readSystemTheme(mm(false, false))).toBeNull();
  expect(readSystemTheme(undefined)).toBeNull();
});
it('applies the theme as a data attribute', () => {
  const el = document.createElement('div');
  applyTheme('light', el);
  expect(el.dataset.theme).toBe('light');
});
