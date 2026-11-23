import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeTransport } from '../transport/fake';
import type { UiSettings } from '../transport/generated/UiSettings';
import { useSettingsStore } from './settingsStore';

const initial: UiSettings = {
  language: 'system',
  theme: 'system',
  discLines: ['winrate', 'scoreLead'],
  visitLimit: null,
  defaultRules: { kind: 'chinese' },
  showCoordinates: true,
  perspective: 'black',
  showNextMove: true,
  analyseOnOpen: false,
  cacheCapMb: 1024,
  saveAnalysis: false,
  jobOptions: {
    range: { kind: 'whole' },
    side: 'both',
    visits: 500,
    boost: { on: true, threshold: 10, visits: 3000 },
  },
};

describe('useSettingsStore.save', () => {
  beforeEach(() => useSettingsStore.setState({ settings: initial }));

  it('applies the new settings before the request answers, then keeps the reply', async () => {
    let answer!: () => void;
    const next = { ...initial, theme: 'light' as const };
    const transport = createFakeTransport(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ type: 'settings', settings: next });
        }),
    );
    const saving = useSettingsStore.getState().save(transport, next);
    expect(useSettingsStore.getState().settings).toEqual(next);
    answer();
    await saving;
    expect(useSettingsStore.getState().settings).toEqual(next);
  });

  it('reverts to the previous settings when the request is rejected', async () => {
    const transport = createFakeTransport(() => {
      throw { code: 'internal', message: 'disk full' };
    });
    await expect(
      useSettingsStore.getState().save(transport, { ...initial, language: 'en' }),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(useSettingsStore.getState().settings).toEqual(initial);
  });

  it('does not undo a later change when an earlier save fails', async () => {
    let fail!: () => void;
    const transport = createFakeTransport((request) => {
      if (request.type === 'settingsSet' && request.settings.language === 'system') {
        return new Promise((_, reject) => {
          fail = () => reject({ code: 'internal', message: 'late failure' });
        });
      }
      if (request.type === 'settingsSet') return { type: 'settings', settings: request.settings };
      throw new Error('unexpected');
    });
    const first = useSettingsStore.getState().save(transport, { ...initial, theme: 'light' });
    const later = { ...initial, theme: 'light' as const, language: 'en' as const };
    await useSettingsStore.getState().save(transport, later);
    fail();
    await expect(first).rejects.toMatchObject({ code: 'internal' });
    expect(useSettingsStore.getState().settings).toEqual(later);
  });
});
