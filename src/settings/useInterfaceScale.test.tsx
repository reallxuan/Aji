import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { useInterfaceScale } from './useInterfaceScale';

afterEach(() => {
  document.documentElement.style.fontSize = '';
});

it('scale_125_sets_the_root_font_size_at_once', () => {
  renderHook(() => useInterfaceScale());
  expect(document.documentElement.style.fontSize).toBe('');
  act(() => useDeviceStore.getState().update({ interfaceScale: 125 }));
  // Tailwind sizes in rem, so the panels scale; the board is sized in pixels by the window.
  expect(document.documentElement.style.fontSize).toBe('125%');
  act(() => useDeviceStore.getState().update({ interfaceScale: 100 }));
  expect(document.documentElement.style.fontSize).toBe('');
});
