import { describe, expect, it } from 'vitest';
import { storedSettings as uiSettings } from '../setup/testing';
import { DEFAULT_DEVICE_SETTINGS } from './deviceSettings';
import { migrateFromBackend } from './migrate';

describe('migrateFromBackend', () => {
  it('migration copies three fields once', () => {
    const backend = {
      ...uiSettings,
      showCoordinates: false,
      discLines: ['visits', 'winrate'] as const,
      perspective: 'white' as const,
    };
    const once = migrateFromBackend(DEFAULT_DEVICE_SETTINGS, {
      ...backend,
      discLines: [...backend.discLines],
    });
    expect(once).toMatchObject({
      showCoordinates: false,
      discLines: ['visits', 'winrate'],
      perspective: 'white',
      migrated: true,
    });
    const again = migrateFromBackend(once, { ...uiSettings, showCoordinates: true });
    expect(again).toBe(once);
  });
});
