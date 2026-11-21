/** Where device settings are kept: one string, read and written whole (P2 M1 design 4.2). */
export interface DeviceStorage {
  read(): string | null;
  write(value: string): void;
}

const KEY = 'aji.device';

/** In memory only: for tests, and for a browser whose storage is unavailable. */
export function memoryDeviceStorage(): DeviceStorage {
  let value: string | null = null;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}

/**
 * The webview's `localStorage`. A storage that throws (a private window, storage disabled) falls
 * back to memory for the session, so device settings still work until the app closes.
 */
export function localDeviceStorage(): DeviceStorage {
  const memory = memoryDeviceStorage();
  let broken = false;
  return {
    read() {
      if (broken) return memory.read();
      try {
        return globalThis.localStorage.getItem(KEY);
      } catch {
        broken = true;
        return memory.read();
      }
    },
    write(value) {
      memory.write(value);
      if (broken) return;
      try {
        globalThis.localStorage.setItem(KEY, value);
      } catch {
        broken = true;
      }
    },
  };
}
