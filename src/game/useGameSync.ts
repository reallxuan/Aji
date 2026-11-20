import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore, useEngineStoreApi } from '../engine/engineStore';
import { usePlatformFiles } from '../platform/PlatformProvider';
import { getGameSnapshot } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { useGameStore } from './gameStore';
import { windowTitle } from './title';

/**
 * Loads the game, follows `gameSnapshot` events, keeps the engine store on the game's position
 * and the window title on the game's. `ready` turns true once both the first snapshot and the
 * first engine status are in, so the panel's first frame shows neither half alone.
 */
export function useGameSync(): { ready: boolean } {
  const transport = useTransport();
  const engine = useEngineStoreApi();
  const files = usePlatformFiles();
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;
    useGameStore.getState().bindEngine(engine);
    // Subscribe first, so a change made while the first request is in flight is not lost.
    const unsubscribe = transport.subscribe((event) => {
      if (active && event.type === 'gameSnapshot') useGameStore.getState().apply(event.snapshot);
    });
    getGameSnapshot(transport).then(
      ({ snapshot }) => {
        if (active) useGameStore.getState().apply(snapshot);
      },
      () => {
        // The board stays empty; the next pushed snapshot fills it in.
        if (active) useGameStore.getState().markLoaded();
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [transport, engine]);

  const snapshot = useGameStore((s) => s.snapshot);
  const title = windowTitle(snapshot, t);
  useEffect(() => {
    files.setWindowTitle(title).catch(() => {});
  }, [files, title]);

  const loaded = useGameStore((s) => s.loaded);
  const engineState = useEngineStore((s) => s.engine);
  return { ready: loaded && engineState !== null };
}
