import { captureReplayVisit, stopReplay } from './replayStore';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { NavTarget } from '../transport/generated/NavTarget';
import { navigate } from './actions';
import { useActionContext } from './useActionContext';

/**
 * Navigation for held keys and the wheel: at most one request per animation frame, the latest
 * target winning, so a burst of key repeats or wheel events never queues up behind itself.
 */
export function useFrameNavigate(): (to: NavTarget, isCurrent?: () => boolean) => void {
  const ctx = useActionContext();
  const latest = useRef(ctx);
  useLayoutEffect(() => {
    latest.current = ctx;
  });
  const pending = useRef<{ to: NavTarget; isCurrent?: () => boolean } | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return useCallback((to: NavTarget, isCurrent?: () => boolean) => {
    stopReplay();
    const visit = captureReplayVisit(latest.current.transport);
    pending.current = {
      to,
      isCurrent: visit ? () => visit() && (!isCurrent || isCurrent()) : isCurrent,
    };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const target = pending.current;
      pending.current = null;
      if (target && (!target.isCurrent || target.isCurrent()))
        void navigate(latest.current, target.to);
    });
  }, []);
}
