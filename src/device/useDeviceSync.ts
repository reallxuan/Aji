import { useEffect } from 'react';
import { startedNarrow } from '../layout/startedNarrow';
import { useSettingsStore } from '../settings/settingsStore';
import { useDeviceStore } from './deviceStore';
import { migrateFromBackend } from './migrate';
import { localDeviceStorage } from './storage';

/**
 * Loads this device's settings from the webview's storage, once, and copies the three display
 * fields from the backend's settings the first time they arrive (P2 M1 design 5.8). The first
 * launch also records whether it started narrow, which keeps the default style (design 5.5).
 */
export function useDeviceSync(): void {
  if (!useDeviceStore.getState().loaded) useDeviceStore.getState().load(localDeviceStorage());
  const backend = useSettingsStore((s) => s.settings);

  useEffect(() => {
    const { settings, update, foreign } = useDeviceStore.getState();
    if (foreign || settings.startedNarrow !== null) return;
    update({ startedNarrow: startedNarrow(settings.layout) });
  }, []);

  useEffect(() => {
    if (!backend) return;
    const { settings, update, foreign } = useDeviceStore.getState();
    // A store this build cannot read is left alone until the user changes something.
    if (foreign) return;
    const migrated = migrateFromBackend(settings, backend);
    if (migrated !== settings) update(migrated);
  }, [backend]);
}
