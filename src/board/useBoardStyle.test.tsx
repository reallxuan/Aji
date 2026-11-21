import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { resetDeviceStore } from '../device/deviceStore';
import { useDeviceSync } from '../device/useDeviceSync';
import { resetStartedNarrow } from '../layout/startedNarrow';
import { useBoardStyle } from './useBoardStyle';

beforeEach(() => localStorage.clear());

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
