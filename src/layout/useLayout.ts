import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDeviceStore } from '../device/deviceStore';
import { LAYOUT_SAVE_MS } from './constants';
import type { Layout } from './model';
import { validateLayout } from './validate';

/**
 * The device's layout, validated (design 5.1). A change shows at once and is stored shortly after
 * the last one, so a drag that changes it many times writes once.
 */
export function useLayout(): { layout: Layout; setLayout(next: Layout): void } {
  const stored = useDeviceStore((s) => s.settings.layout);
  const validated = useMemo(() => validateLayout(stored), [stored]);
  const [pending, setPending] = useState<Layout | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const setLayout = useCallback((next: Layout) => {
    setPending(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      useDeviceStore.getState().update({ layout: next });
      setPending(null);
    }, LAYOUT_SAVE_MS);
  }, []);

  return { layout: pending ?? validated, setLayout };
}
