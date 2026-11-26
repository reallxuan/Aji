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
      autoReplaySeconds: 0.75,
      openAt: 'last',
      moveNumbers: { mode: 'last', last: 15, restartInBranch: true, lastOn: 'last' },
      layout: { anything: true },
      narrowTab: 'candidates',
      keymap: { ArrowLeft: 'nav.next' },
      boardStyles: {
        dark: { board: 'ink', stones: 'flat' },
        light: { board: 'walnut', stones: 'yunzi' },
      },
      grainStrength: 0.6,
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
      swingBy: 'score',
      swingThreshold: { winrate: 8, score: 3.5 },
      swingAfterOnly: true,
    };
    expect(parseDeviceSettings(raw)).toEqual(raw);
  });

  it('rejects a board style naming an unknown board, and equal disc lines', () => {
    const parsed = parseDeviceSettings({
      version: 1,
      boardStyles: {
        dark: { board: 'oak', stones: 'flat' },
        light: { board: 'kaya', stones: 'flat' },
      },
      discLines: ['winrate', 'winrate'],
      keymap: { a: 3 },
    });
    // Only the theme with the unknown board falls back.
    expect(parsed.boardStyles).toEqual({ dark: null, light: { board: 'kaya', stones: 'flat' } });
    expect(parsed.discLines).toEqual(['winrate', 'scoreLead']);
    expect(parsed.keymap).toEqual({});
  });

  it('a single board style from before the dark boards design applies to both themes', () => {
    const parsed = parseDeviceSettings({
      version: 1,
      boardStyle: { board: 'walnut', stones: 'slate' },
    });
    expect(parsed.boardStyles).toEqual({
      dark: { board: 'walnut', stones: 'slate' },
      light: { board: 'walnut', stones: 'slate' },
    });
    expect(parsed).not.toHaveProperty('boardStyle');
  });

  it('a grain strength outside 0 to 1 reads as the default (UI polish design 3)', () => {
    for (const grainStrength of [-0.1, 1.5, Number.NaN, '0.5'])
      expect(parseDeviceSettings({ version: 1, grainStrength }).grainStrength).toBe(0.35);
    expect(parseDeviceSettings({ version: 1, grainStrength: 0 }).grainStrength).toBe(0);
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

  it('the swing list starts by win rate over 5%, or 2 points by score (P2 M2 design 5.4)', () => {
    const d = parseDeviceSettings({ version: 1, swingThreshold: { winrate: -1, score: 'x' } });
    expect(d.swingBy).toBe('winrate');
    expect(d.swingThreshold).toEqual({ winrate: 5, score: 2 });
    expect(d.swingAfterOnly).toBe(false);
  });
});

it('old device settings migrate with replay and opening defaults', () => {
  expect(parseDeviceSettings({ version: 1, migrated: true })).toMatchObject({
    autoReplaySeconds: 1.5,
    openAt: 'first',
  });
  expect(
    parseDeviceSettings({ version: 1, autoReplaySeconds: 0.75, openAt: 'last' }),
  ).toMatchObject({ autoReplaySeconds: 0.75, openAt: 'last' });
  expect(parseDeviceSettings({ version: 1, autoReplaySeconds: -1, openAt: 'bad' })).toMatchObject({
    autoReplaySeconds: 1.5,
    openAt: 'first',
  });
});

it('rejects replay intervals too large for a browser timer', () => {
  expect(parseDeviceSettings({ version: 1, autoReplaySeconds: 1e10 }).autoReplaySeconds).toBe(1.5);
});
