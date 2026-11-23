import { useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider';
import { useJobStore } from './jobStore';

/** Keeps the job store on the backend's `jobProgress` events. */
export function useJobSync(): void {
  const transport = useTransport();
  useEffect(
    () =>
      transport.subscribe((event) => {
        if (event.type === 'jobProgress') useJobStore.getState().apply(event.progress);
      }),
    [transport],
  );
}
