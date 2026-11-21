import type { UiSettings } from '../transport/generated/UiSettings';
import type { DeviceSettings } from './deviceSettings';

/**
 * On the first launch after device settings exist, copies the three display fields that used to
 * live in the backend's settings (P2 M1 design 5.8). Once copied, the backend's values are ignored,
 * and the same object comes back unchanged.
 */
export function migrateFromBackend(device: DeviceSettings, ui: UiSettings): DeviceSettings {
  if (device.migrated) return device;
  return {
    ...device,
    showCoordinates: ui.showCoordinates,
    discLines: [ui.discLines[0], ui.discLines[1]],
    perspective: ui.perspective,
    migrated: true,
  };
}
