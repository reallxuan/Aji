import { useGameStore } from '../game/gameStore';
import { useTrendStore } from '../analysis/trendStore';
import { useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider';
import { useJobStore } from './jobStore';

/**
 * Keeps job progress and coverage across line changes until the service resets analysis.
 */
export function useJobSync(): void {
  const transport = useTransport();
  useEffect(
    () =>
      transport.subscribe((event) => {
        if (event.type === 'jobProgress') useJobStore.getState().apply(event.progress);
        else if (
          event.type === 'gameTrend' &&
          event.reason === 'reset' &&
          event.revision >=
            Math.max(
              useGameStore.getState().snapshot?.lineRevision ?? -1,
              useTrendStore.getState().lineRevision ?? -1,
            )
        )
          useJobStore.getState().hideStrip();
      }),
    [transport],
  );
}
