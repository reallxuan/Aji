import type { BoardId, DeviceSettings, StoneId } from '../device/deviceSettings';

/**
 * A board style is data (P2 M1 design 5.7): the base colour, the grain, the inks and the line
 * weight. The grain is today's procedural grain (M5), scaled: `density` shortens its periods for
 * a finer figure, `amplitude` deepens or softens it. Each wood's darker and lighter fibres are
 * its own base, shaded; `null` is a flat surface.
 */
export interface BoardStyle {
  id: BoardId;
  base: string;
  grain: { density: number; amplitude: number } | null;
  line: string;
  star: string;
  label: string;
  /** Grid lines' width as a share of honey's. */
  lineWeight: number;
}

/** Honey is Phase 1's board; the others are the board styles mockup's. */
export const BOARD_STYLES: Record<BoardId, BoardStyle> = {
  honey: {
    id: 'honey',
    base: '#DDB067',
    grain: { density: 1, amplitude: 1 },
    line: '#3A2A14',
    star: '#3A2A14',
    label: 'rgba(58, 42, 20, 0.8)',
    lineWeight: 1,
  },
  kaya: {
    id: 'kaya',
    base: '#E9C98A',
    // The mockup's kaya has twice honey's fibres, at three quarters of their depth.
    grain: { density: 2, amplitude: 0.75 },
    line: '#4A3518',
    star: '#4A3518',
    label: 'rgba(74, 53, 24, 0.8)',
    lineWeight: 1,
  },
  walnut: {
    id: 'walnut',
    base: '#6E4A2C',
    grain: { density: 1.15, amplitude: 1.5 },
    line: 'rgba(236,220,190,.78)',
    star: 'rgba(236,220,190,.78)',
    label: 'rgba(236,220,190,.7)',
    lineWeight: 1,
  },
  printed: {
    id: 'printed',
    base: '#F1E7CF',
    grain: null,
    line: '#4F4232',
    star: '#4F4232',
    label: 'rgba(79, 66, 50, 0.75)',
    lineWeight: 0.7,
  },
};

export type StyleChoice = { board: BoardId; stones: StoneId };

/** The four sets of design 5.7, in the order the settings show them. */
export const SETS: StyleChoice[] = [
  { board: 'honey', stones: 'slate' },
  { board: 'kaya', stones: 'yunzi' },
  { board: 'walnut', stones: 'slate' },
  { board: 'printed', stones: 'flat' },
];

export const sameStyle = (a: StyleChoice, b: StyleChoice) =>
  a.board === b.board && a.stones === b.stones;

/**
 * The style to draw: the device's choice, or the default. A device that started in the phone
 * layout defaults to printed with flat stones (design 5.5); any other to honey with slate.
 */
export function effectiveStyle(
  device: Pick<DeviceSettings, 'boardStyle'>,
  startedNarrow: boolean,
): StyleChoice {
  if (device.boardStyle) return device.boardStyle;
  return startedNarrow ? SETS[3] : SETS[0];
}
