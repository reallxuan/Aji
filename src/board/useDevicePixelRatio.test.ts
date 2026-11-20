import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDevicePixelRatio } from './useDevicePixelRatio';

describe('useDevicePixelRatio', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('re-renders with the new ratio when the resolution query changes', () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      matches: true,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    const { result } = renderHook(() => useDevicePixelRatio());
    expect(result.current).toBe(1);

    vi.stubGlobal('devicePixelRatio', 2);
    act(() => [...listeners].forEach((listener) => listener()));
    expect(result.current).toBe(2);
    expect(listeners.size).toBe(1);
  });
});
