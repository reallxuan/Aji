import { useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider';
import { useJobStore } from './jobStore';

/**
 * Keeps the job store on the backend's `jobProgress` events. A whole-trend push comes only with
 * another game, new rules or a cleared game, so it hides the strip.
 */
export function useJobSync(): void {
  const transport = useTransport();
  useEffect(
    () =>
      transport.subscribe((event) => {
        if (event.type === 'jobProgress') useJobStore.getState().apply(event.progress);
        else if (event.type === 'gameTrend') useJobStore.getState().hideStrip();
      }),
    [transport],
  );
}
