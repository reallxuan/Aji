import { describe, expect, it, vi } from 'vitest';
import { localDeviceStorage, memoryDeviceStorage } from './storage';

describe('device storage', () => {
  it('memory storage reads back what it wrote', () => {
    const storage = memoryDeviceStorage();
    expect(storage.read()).toBeNull();
    storage.write('{"a":1}');
    expect(storage.read()).toBe('{"a":1}');
  });

  it('local storage uses one key', () => {
    localStorage.clear();
    const storage = localDeviceStorage();
    storage.write('x');
    expect(localStorage.getItem('aji.device')).toBe('x');
    expect(localDeviceStorage().read()).toBe('x');
  });

  it('throwing storage falls back to memory', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      const storage = localDeviceStorage();
      expect(storage.read()).toBeNull();
      storage.write('kept');
      expect(storage.read()).toBe('kept');
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
