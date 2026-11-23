import { useEffect, useRef } from 'react';
import { scoreGame } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { useEstimateStore } from './estimateStore';
import { useShownCandidates } from './useShownCandidates';

/** The least time between two counts while the search deepens. */
export const ESTIMATE_THROTTLE_MS = 500;

/**
 * Keeps the estimate's count on the position on the board while 形势判断 is on: asked for again
 * with each new ownership, at most every half second, and cleared when the position changes or
 * has no ownership yet (P2 M2 design 5.7).
 */
export function useEstimateSync(): void {
  const transport = useTransport();
  const on = useEstimateStore((s) => s.on);
  const { current } = useShownCandidates();
  const ownership = current?.ownership ?? null;
  const position = current?.position ?? null;
  const last = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    // Another position, or none: its count is not this one's.
    if (shownFor.current !== position) {
      shownFor.current = position;
      useEstimateStore.getState().setScore(null);
    }
  }, [position]);

  useEffect(() => {
    if (!on || !ownership || !position) return;
    const ask = () => {
      timer.current = null;
      last.current = Date.now();
      // A delayed ask counts whatever is on the board by then.
      const asked = shownFor.current;
      scoreGame(transport, { kind: 'estimate' }).then(
        (score) => {
          if (useEstimateStore.getState().on && shownFor.current === asked)
            useEstimateStore.getState().setScore(score);
        },
        () => {
          // No ownership in the cache yet: the line keeps waiting for the next update.
        },
      );
    };
    const wait = last.current + ESTIMATE_THROTTLE_MS - Date.now();
    if (wait <= 0) ask();
    else if (!timer.current) timer.current = setTimeout(ask, wait);
  }, [on, ownership, position, transport]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
}
