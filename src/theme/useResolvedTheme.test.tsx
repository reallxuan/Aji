import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { applyTheme } from './theme';
import { useResolvedTheme } from './useResolvedTheme';

afterEach(() => delete document.documentElement.dataset.theme);

it('is dark until a theme is applied', () => {
  delete document.documentElement.dataset.theme;
  expect(renderHook(() => useResolvedTheme()).result.current).toBe('dark');
});

it('follows the theme as it is applied', async () => {
  applyTheme('light');
  const { result } = renderHook(() => useResolvedTheme());
  expect(result.current).toBe('light');
  act(() => applyTheme('dark'));
  await waitFor(() => expect(result.current).toBe('dark'));
});
