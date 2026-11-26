import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { resetDeviceStore, useDeviceStore } from '../device/deviceStore';
import { applyTheme } from '../theme/theme';
import { useDeviceSync } from '../device/useDeviceSync';
import { resetStartedNarrow } from '../layout/startedNarrow';
import { useBoardStyle } from './useBoardStyle';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

/** One launch of the app in a window of this size: a fresh session over the same storage. */
function launch(innerWidth: number, innerHeight: number) {
  resetDeviceStore();
  resetStartedNarrow();
  Object.assign(window, { innerWidth, innerHeight });
  const { result, unmount } = renderHook(() => {
    useDeviceSync();
    return useBoardStyle();
  });
  const style = result.current;
  unmount();
  return style;
}

it('the default style is decided on the first launch and kept on later ones', () => {
  // Design 5.5: a device that starts in the phone layout, not a session.
  expect(launch(375, 812)).toEqual({ board: 'printed', stones: 'flat' });
  expect(launch(1440, 900)).toEqual({ board: 'printed', stones: 'flat' });
  localStorage.clear();
  expect(launch(1440, 900)).toEqual({ board: 'honey', stones: 'slate' });
  expect(launch(375, 812)).toEqual({ board: 'honey', stones: 'slate' });
});

it('a store this build cannot read is not written to keep the answer', () => {
  const stored = JSON.stringify({ version: 2 });
  localStorage.setItem('aji.device', stored);
  expect(launch(375, 812)).toEqual({ board: 'printed', stones: 'flat' });
  expect(localStorage.getItem('aji.device')).toBe(stored);
});

it('draws the board chosen for the theme the window is in, and follows a switch', async () => {
  resetDeviceStore();
  Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
  applyTheme('dark');
  const { result } = renderHook(() => {
    useDeviceSync();
    return useBoardStyle();
  });
  act(() =>
    useDeviceStore.getState().update({
      boardStyles: { dark: { board: 'graphite', stones: 'flat' }, light: null },
    }),
  );
  expect(result.current).toEqual({ board: 'graphite', stones: 'flat' });
  act(() => applyTheme('light'));
  await waitFor(() => expect(result.current).toEqual({ board: 'honey', stones: 'slate' }));
});
