import { captureReplayVisit, stopReplay } from './replayStore';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { NavTarget } from '../transport/generated/NavTarget';
import type { Transport } from '../transport/transport';
import { navigate } from './actions';
import { useActionContext } from './useActionContext';

type FrameOptions = {
  isCurrent?: () => boolean;
  /** Drop further requests with this option until the sent request applies its reply. */
  waitForReply?: boolean;
};

export type FrameNavigate = (to: NavTarget, options?: FrameOptions) => void;

const awaitingReplies = new WeakSet<Transport>();

/**
 * Navigation for held keys and the wheel: at most one request per animation frame, the latest
 * target winning, so a burst of key repeats or wheel events never queues up behind itself.
 */
export function useFrameNavigate(): FrameNavigate {
  const ctx = useActionContext();
  const latest = useRef(ctx);
  useLayoutEffect(() => {
    latest.current = ctx;
  });
  const pending = useRef<({ to: NavTarget } & FrameOptions) | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return useCallback<FrameNavigate>((to, { isCurrent, waitForReply } = {}) => {
    const { transport } = latest.current;
    if (waitForReply && awaitingReplies.has(transport)) return;
    stopReplay();
    const visit = captureReplayVisit(transport);
    pending.current = {
      to,
      isCurrent: visit ? () => visit() && (!isCurrent || isCurrent()) : isCurrent,
      waitForReply,
    };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const target = pending.current;
      pending.current = null;
      if (!target || (target.isCurrent && !target.isCurrent())) return;
      const ctx = latest.current;
      // Only a request that survived coalescing reserves the next reply.
      if (target.waitForReply) {
        if (awaitingReplies.has(ctx.transport)) return;
        awaitingReplies.add(ctx.transport);
      }
      const reply = navigate(ctx, target.to);
      if (target.waitForReply) void reply.finally(() => awaitingReplies.delete(ctx.transport));
    });
  }, []);
}
