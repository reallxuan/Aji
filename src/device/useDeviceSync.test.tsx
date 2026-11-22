import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings/settingsStore';
import { storedSettings } from '../setup/testing';
import { DEFAULT_DEVICE_SETTINGS } from './deviceSettings';
import { resetDeviceStore, useDeviceStore } from './deviceStore';
import { useDeviceSync } from './useDeviceSync';

describe('useDeviceSync', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDeviceStore();
    useSettingsStore.setState({ settings: null });
  });

  it('loads the stored device settings on mount', () => {
    localStorage.setItem(
      'aji.device',
      JSON.stringify({ ...DEFAULT_DEVICE_SETTINGS, interfaceScale: 150, migrated: true }),
    );
    renderHook(() => useDeviceSync());
    expect(useDeviceStore.getState().loaded).toBe(true);
    expect(useDeviceStore.getState().settings.interfaceScale).toBe(150);
  });

  it('copies the backend fields once the backend settings arrive', () => {
    renderHook(() => useDeviceSync());
    expect(useDeviceStore.getState().settings.migrated).toBe(false);
    act(() => useSettingsStore.getState().apply({ ...storedSettings, showCoordinates: false }));
    expect(useDeviceStore.getState().settings).toMatchObject({
      showCoordinates: false,
      migrated: true,
    });
    expect(JSON.parse(localStorage.getItem('aji.device') ?? '{}').migrated).toBe(true);
    act(() => useSettingsStore.getState().apply({ ...storedSettings, showCoordinates: true }));
    expect(useDeviceStore.getState().settings.showCoordinates).toBe(false);
  });

  it('leaves a newer or broken store unwritten when the backend settings arrive', () => {
    // Review Focus 1: a newer Aji's value stays until the user changes something.
    for (const stored of [JSON.stringify({ version: 2, layout: { v: 2 } }), '{"version":1,"lay']) {
      localStorage.setItem('aji.device', stored);
      resetDeviceStore();
      useSettingsStore.setState({ settings: null });
      const { unmount } = renderHook(() => useDeviceSync());
      act(() => useSettingsStore.getState().apply({ ...storedSettings, showCoordinates: false }));
      expect(localStorage.getItem('aji.device')).toBe(stored);
      expect(useDeviceStore.getState().settings.showCoordinates).toBe(true);
      unmount();
    }
  });
});
