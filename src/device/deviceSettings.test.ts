import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_SETTINGS, parseDeviceSettings } from './deviceSettings';

describe('parseDeviceSettings', () => {
  it('a bad field falls back alone', () => {
    const parsed = parseDeviceSettings({ version: 1, interfaceScale: 133, showCoordinates: false });
    expect(parsed.interfaceScale).toBe(100);
    expect(parsed.showCoordinates).toBe(false);
  });

  it('garbage reads as defaults', () => {
    for (const raw of ['nope', null, [1, 2], 42, undefined]) {
      expect(parseDeviceSettings(raw)).toEqual(DEFAULT_DEVICE_SETTINGS);
    }
  });

  it('keeps every valid field', () => {
    const raw = {
      version: 1,
      layout: { anything: true },
      narrowTab: 'candidates',
      keymap: { ArrowLeft: 'nav.next' },
      boardStyle: { board: 'walnut', stones: 'yunzi' },
      interfaceScale: 125,
      showCoordinates: false,
      discLines: ['visits', 'winrate'],
      perspective: 'white',
      scoreWithKomi: false,
      alwaysOnTop: true,
      migrated: true,
    };
    expect(parseDeviceSettings(raw)).toEqual(raw);
  });

  it('rejects a board style naming an unknown board, and equal disc lines', () => {
    const parsed = parseDeviceSettings({
      version: 1,
      boardStyle: { board: 'oak', stones: 'flat' },
      discLines: ['winrate', 'winrate'],
      keymap: { a: 3 },
    });
    expect(parsed.boardStyle).toBeNull();
    expect(parsed.discLines).toEqual(['winrate', 'scoreLead']);
    expect(parsed.keymap).toEqual({});
  });

  it('a newer version reads as defaults', () => {
    expect(parseDeviceSettings({ version: 2, showCoordinates: false })).toEqual(
      DEFAULT_DEVICE_SETTINGS,
    );
  });
});
