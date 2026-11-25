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

  it('the four sets', () => {
    expect(SETS).toEqual([
      { board: 'honey', stones: 'slate' },
      { board: 'kaya', stones: 'yunzi' },
      { board: 'walnut', stones: 'slate' },
      { board: 'printed', stones: 'flat' },
    ]);
  });

  it('the default style depends on the device', () => {
    const device = { ...DEFAULT_DEVICE_SETTINGS, boardStyle: null };
    expect(effectiveStyle(device, false)).toEqual({ board: 'honey', stones: 'slate' });
    expect(effectiveStyle(device, true)).toEqual({ board: 'printed', stones: 'flat' });
    const chosen = { ...device, boardStyle: { board: 'kaya' as const, stones: 'flat' as const } };
    expect(effectiveStyle(chosen, true)).toEqual({ board: 'kaya', stones: 'flat' });
  });
});
