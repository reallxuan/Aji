import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_SETTINGS } from './deviceSettings';
import { resetDeviceStore, useDeviceStore } from './deviceStore';
import { memoryDeviceStorage } from './storage';

describe('the device store', () => {
  beforeEach(() => resetDeviceStore());

  it('loads stored settings and marks itself loaded', () => {
    const storage = memoryDeviceStorage();
    storage.write(JSON.stringify({ ...DEFAULT_DEVICE_SETTINGS, interfaceScale: 125 }));
    useDeviceStore.getState().load(storage);
    expect(useDeviceStore.getState().loaded).toBe(true);
    expect(useDeviceStore.getState().settings.interfaceScale).toBe(125);
  });

  it('update writes through', () => {
    const storage = memoryDeviceStorage();
    useDeviceStore.getState().load(storage);
    useDeviceStore.getState().update({ showCoordinates: false });
    expect(useDeviceStore.getState().settings.showCoordinates).toBe(false);
    expect(JSON.parse(storage.read() ?? '{}').showCoordinates).toBe(false);
  });

  it('a newer version reads as defaults and is not overwritten by loading', () => {
    const storage = memoryDeviceStorage();
    const newer = JSON.stringify({ version: 2, showCoordinates: false });
    storage.write(newer);
    useDeviceStore.getState().load(storage);
    expect(useDeviceStore.getState().settings).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(storage.read()).toBe(newer);
    useDeviceStore.getState().update({ interfaceScale: 110 });
    expect(JSON.parse(storage.read() ?? '{}').version).toBe(1);
  });

  it('unreadable JSON reads as defaults', () => {
    const storage = memoryDeviceStorage();
    storage.write('{"version":1,"showCoo');
    useDeviceStore.getState().load(storage);
    expect(useDeviceStore.getState().settings).toEqual(DEFAULT_DEVICE_SETTINGS);
  });
});
