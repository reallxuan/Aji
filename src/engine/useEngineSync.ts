import { useEffect } from 'react';
import { getEngineStatus } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { useEngineStoreApi } from './engineStore';

/** Subscribes to pushed events first, then asks for the current state, so no transition is missed. */
export function useEngineSync(): void {
  const transport = useTransport();
  const store = useEngineStoreApi();

  useEffect(() => {
    let active = true;
    const unsubscribe = transport.subscribe((event) => {
      if (active) store.getState().applyEvent(event);
    });
    getEngineStatus(transport).then(
      (engine) => {
        if (active) store.getState().applyStatus(engine);
      },
      () => {
        // The status line stays empty; the next pushed event fills it in.
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [transport, store]);
}
