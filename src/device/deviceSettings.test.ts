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
      startedNarrow: true,
      interfaceScale: 125,
      showCoordinates: false,
      discLines: ['visits', 'winrate'],
      perspective: 'white',
      scoreWithKomi: false,
      alwaysOnTop: true,
      migrated: true,
      candidateSort: { key: 'visits', descending: false },
      candidateColumns: {
        winrate: true,
        scoreLead: false,
        visits: true,
        share: false,
        vsBest: true,
      },
      candidateCount: 5,
      lineLength: 10,
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

  it('the candidate list starts in KataGo’s order, without 与最佳相比 (P2 M2 design 5.5)', () => {
    const d = parseDeviceSettings({ version: 1 });
    expect(d.candidateSort).toEqual({ key: 'rank', descending: true });
    expect(d.candidateColumns).toEqual({
      winrate: true,
      scoreLead: true,
      visits: true,
      share: true,
      vsBest: false,
    });
    expect(d.candidateCount).toBe('auto');
    expect(d.lineLength).toBe(20);
  });

  it('bad candidate fields fall back alone', () => {
    const d = parseDeviceSettings({
      version: 1,
      candidateSort: { key: 'prior', descending: true },
      candidateColumns: { winrate: false, scoreLead: 'yes' },
      candidateCount: 7,
      lineLength: 0,
    });
    expect(d.candidateSort).toEqual({ key: 'rank', descending: true });
    expect(d.candidateColumns).toEqual({
      winrate: false,
      scoreLead: true,
      visits: true,
      share: true,
      vsBest: false,
    });
    expect(d.candidateCount).toBe('auto');
    expect(d.lineLength).toBe(20);
  });
});
