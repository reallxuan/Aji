import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_SETTINGS } from '../device/deviceSettings';
import { BOARD_STYLES, effectiveStyle, SETS } from './styles';

describe('board styles', () => {
  it('honey keeps Phase 1 values', () => {
    expect(BOARD_STYLES.honey).toMatchObject({
      base: '#DDB067',
      line: '#3A2A14',
      star: '#3A2A14',
      label: 'rgba(58, 42, 20, 0.8)',
      lineWeight: 1,
      grain: { map: 'honey', contrast: 0.1 },
    });
  });

  it('the other boards take the mockup values', () => {
    expect(BOARD_STYLES.kaya).toMatchObject({ base: '#E9C98A', line: '#4A3518' });
    expect(BOARD_STYLES.walnut).toMatchObject({
      base: '#6E4A2C',
      line: 'rgba(236,220,190,.78)',
      label: 'rgba(236,220,190,.7)',
    });
    expect(BOARD_STYLES.printed).toMatchObject({
      base: '#F1E7CF',
      line: '#4F4232',
      grain: null,
      lineWeight: 0.7,
    });
  });

  it('the six sets, the dark boards last', () => {
    expect(SETS).toEqual([
      { board: 'honey', stones: 'slate' },
      { board: 'kaya', stones: 'yunzi' },
      { board: 'walnut', stones: 'slate' },
      { board: 'printed', stones: 'flat' },
      { board: 'graphite', stones: 'flat' },
      { board: 'ink', stones: 'flat' },
    ]);
  });

  it('graphite and ink are flat dark boards (dark boards design)', () => {
    expect(BOARD_STYLES.graphite).toMatchObject({
      base: '#2A2A2E',
      line: 'rgba(236,234,228,.34)',
      star: 'rgba(236,234,228,.6)',
      label: 'rgba(236,234,228,.5)',
      grain: null,
      lineWeight: 0.7,
    });
    expect(BOARD_STYLES.ink).toMatchObject({
      base: '#0E0E10',
      line: 'rgba(236,234,228,.26)',
      star: 'rgba(236,234,228,.55)',
      label: 'rgba(236,234,228,.45)',
      grain: null,
      lineWeight: 0.7,
    });
  });

  it('the dark boards draw light inks and K2, W3 flat stones', () => {
    for (const id of ['graphite', 'ink'] as const) {
      expect(BOARD_STYLES[id].ink).toEqual({
        mark: '#ECEAE4',
        badgeOutline: 'rgba(236,234,228,.75)',
        badgeFill: '#ECEAE4',
        badgeLetter: '#1f1a14',
        played: '#ECEAE4',
        flat: {
          black: { fill: '#050506', edge: '#5A5A61', edgeWidth: 0.1 },
          white: { fill: '#D6D4CD', edge: 'rgba(0,0,0,.5)', edgeWidth: 0.07 },
        },
      });
    }
  });

  it('the light boards keep their inks, walnut its light marks', () => {
    const light = BOARD_STYLES.honey.ink;
    expect(light).toEqual({
      mark: '#2b1d0e',
      badgeOutline: 'rgba(43,29,14,.7)',
      badgeFill: '#1f1a14',
      badgeLetter: '#f3efe4',
      played: '#2B1D0E',
      flat: {
        black: { fill: '#1b1b1a', edge: '#2a2620', edgeWidth: 0.07 },
        white: { fill: '#fbfaf6', edge: '#2a2620', edgeWidth: 0.07 },
      },
    });
    expect(BOARD_STYLES.kaya.ink).toEqual(light);
    expect(BOARD_STYLES.printed.ink).toEqual(light);
    expect(BOARD_STYLES.walnut.ink).toEqual({ ...light, mark: '#f3efe4', badgeOutline: '#f3efe4' });
  });

  it('the default style depends on the device, in both themes', () => {
    const device = DEFAULT_DEVICE_SETTINGS;
    for (const theme of ['dark', 'light'] as const) {
      expect(effectiveStyle(device, false, theme)).toEqual({ board: 'honey', stones: 'slate' });
      expect(effectiveStyle(device, true, theme)).toEqual({ board: 'printed', stones: 'flat' });
    }
  });

  it('each theme draws its own choice (dark boards design)', () => {
    const device = {
      boardStyles: { dark: { board: 'graphite' as const, stones: 'flat' as const }, light: null },
    };
    expect(effectiveStyle(device, false, 'dark')).toEqual({ board: 'graphite', stones: 'flat' });
    expect(effectiveStyle(device, false, 'light')).toEqual({ board: 'honey', stones: 'slate' });
  });
});
