import { create } from 'zustand';
import {
  DEFAULT_DEVICE_SETTINGS,
  type DeviceSettings,
  parseDeviceSettings,
} from './deviceSettings';
import { type DeviceStorage, memoryDeviceStorage } from './storage';

export interface DeviceState {
  settings: DeviceSettings;
  /** True once `load` has read the storage; the first frame waits for it. */
  loaded: boolean;
  /**
   * The storage holds something this build cannot read: a newer version, or a value cut off
   * mid-write. Nothing is written on the user's behalf (a migration, a first-launch choice) until
   * the user changes a setting, so a newer Aji's value survives running this one (Review Focus 1).
   */
  foreign: boolean;
  /** Reads the storage. Loading never writes, so a newer version's value stays until a change. */
  load(storage: DeviceStorage): void;
  /** Changes some fields and writes the whole object through. */
  update(patch: Partial<DeviceSettings>): void;
}

let storage: DeviceStorage = memoryDeviceStorage();

function read(from: DeviceStorage): { settings: DeviceSettings; foreign: boolean } {
  const text = from.read();
  if (text === null) return { settings: DEFAULT_DEVICE_SETTINGS, foreign: false };
  try {
    const raw: unknown = JSON.parse(text);
    const readable =
      typeof raw === 'object' && raw !== null && (raw as { version?: unknown }).version === 1;
    return { settings: parseDeviceSettings(raw), foreign: !readable };
  } catch {
    return { settings: DEFAULT_DEVICE_SETTINGS, foreign: true };
  }
}

export const useDeviceStore = create<DeviceState>()((set, get) => ({
  settings: DEFAULT_DEVICE_SETTINGS,
  loaded: false,
  foreign: false,
  load(from) {
    storage = from;
    set({ ...read(from), loaded: true });
  },
  update(patch) {
    const settings = { ...get().settings, ...patch, version: 1 as const };
    set({ settings, foreign: false });
    storage.write(JSON.stringify(settings));
  },
}));

/** Back to the unloaded defaults, with memory storage; for tests. */
export function resetDeviceStore(): void {
  storage = memoryDeviceStorage();
  useDeviceStore.setState({ settings: DEFAULT_DEVICE_SETTINGS, loaded: false, foreign: false });
}
