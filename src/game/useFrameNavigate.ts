import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { NavTarget } from '../transport/generated/NavTarget';
import { navigate } from './actions';
import { useActionContext } from './useActionContext';

/**
 * Navigation for held keys and the wheel: at most one request per animation frame, the latest
 * target winning, so a burst of key repeats or wheel events never queues up behind itself.
 */
export function useFrameNavigate(): (to: NavTarget) => void {
  const ctx = useActionContext();
  const latest = useRef(ctx);
  useLayoutEffect(() => {
    latest.current = ctx;
  });
  const pending = useRef<NavTarget | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return useCallback((to: NavTarget) => {
    pending.current = to;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const target = pending.current;
      pending.current = null;
      if (target !== null) void navigate(latest.current, target);
    });
  }, []);
}
