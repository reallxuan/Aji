import type { BoardId, DeviceSettings, StoneId } from '../device/deviceSettings';
import type { Theme } from '../theme/theme';

export type GrainMapId = 'honey' | 'kaya' | 'walnut';

/**
 * A board style is data (P2 M1 design 5.7): the base colour, the grain, the inks and the line
 * weight. The grain is a photographed wood's light and dark (polish design 3): `map` names the
 * grain map in `src/assets/wood`, and `contrast` is the brightness deviation it gives at full
 * strength, multiplied into the base colour. A board with grain also gets the finish (light,
 * sheen and rim). `null` is a flat surface.
 */
export interface BoardStyle {
  id: BoardId;
  base: string;
  grain: { map: GrainMapId; contrast: number } | null;
  line: string;
  star: string;
  label: string;
  /** Grid lines' width as a share of honey's. */
  lineWeight: number;
  ink: BoardInk;
}

/** A flat stone's colours; `edgeWidth` is a share of the stone's radius. */
export interface StoneInk {
  fill: string;
  edge: string;
  edgeWidth: number;
}

export interface FlatStones {
  black: StoneInk;
  white: StoneInk;
}

/**
 * The colours drawn over the board that depend on how dark it is (dark boards design): marks and
 * labels on an empty point, a variation badge and the outline round its point, the ring of the
 * move actually played, and the flat stones. Inks on a stone follow the stone instead.
 */
export interface BoardInk {
  mark: string;
  badgeOutline: string;
  badgeFill: string;
  badgeLetter: string;
  played: string;
  flat: FlatStones;
}

const LIGHT_INK: BoardInk = {
  mark: '#2b1d0e',
  badgeOutline: 'rgba(43,29,14,.7)',
  badgeFill: '#1f1a14',
  badgeLetter: '#f3efe4',
  played: '#2B1D0E',
  flat: {
    black: { fill: '#1b1b1a', edge: '#2a2620', edgeWidth: 0.07 },
    white: { fill: '#fbfaf6', edge: '#2a2620', edgeWidth: 0.07 },
  },
};

/** The owner's picks in the dark boards mockups: K2 black and W3 white stones. */
const DARK_INK: BoardInk = {
  mark: '#ECEAE4',
  badgeOutline: 'rgba(236,234,228,.75)',
  badgeFill: '#ECEAE4',
  badgeLetter: '#1f1a14',
  played: '#ECEAE4',
  flat: {
    black: { fill: '#050506', edge: '#5A5A61', edgeWidth: 0.1 },
    white: { fill: '#D6D4CD', edge: 'rgba(0,0,0,.5)', edgeWidth: 0.07 },
  },
};

/**
 * Honey is Phase 1's board; kaya, walnut and printed are the board styles mockup's; graphite and
 * ink are the dark boards design's, flat like printed.
 */
export const BOARD_STYLES: Record<BoardId, BoardStyle> = {
  honey: {
    id: 'honey',
    base: '#DDB067',
    // Okoume: a flowing grain (板目).
    grain: { map: 'honey', contrast: 0.1 },
    line: '#3A2A14',
    star: '#3A2A14',
    label: 'rgba(58, 42, 20, 0.8)',
    lineWeight: 1,
    ink: LIGHT_INK,
  },
  kaya: {
    id: 'kaya',
    base: '#E9C98A',
    // Ash: a straight grain (柾目), the usual figure of a kaya board.
    grain: { map: 'kaya', contrast: 0.07 },
    line: '#4A3518',
    star: '#4A3518',
    label: 'rgba(74, 53, 24, 0.8)',
    lineWeight: 1,
    ink: LIGHT_INK,
  },
  walnut: {
    id: 'walnut',
    base: '#6E4A2C',
    grain: { map: 'walnut', contrast: 0.13 },
    line: 'rgba(236,220,190,.78)',
    star: 'rgba(236,220,190,.78)',
    label: 'rgba(236,220,190,.7)',
    lineWeight: 1,
    // Light marks on the dark wood; the rest as on the light boards, as before.
    ink: { ...LIGHT_INK, mark: '#f3efe4', badgeOutline: '#f3efe4' },
  },
  printed: {
    id: 'printed',
    base: '#F1E7CF',
    grain: null,
    line: '#4F4232',
    star: '#4F4232',
    label: 'rgba(79, 66, 50, 0.75)',
    lineWeight: 0.7,
    ink: LIGHT_INK,
  },
  graphite: {
    id: 'graphite',
    base: '#2A2A2E',
    grain: null,
    line: 'rgba(236,234,228,.34)',
    star: 'rgba(236,234,228,.6)',
    label: 'rgba(236,234,228,.5)',
    lineWeight: 0.7,
    ink: DARK_INK,
  },
  ink: {
    id: 'ink',
    base: '#0E0E10',
    grain: null,
    line: 'rgba(236,234,228,.26)',
    star: 'rgba(236,234,228,.55)',
    label: 'rgba(236,234,228,.45)',
    lineWeight: 0.7,
    ink: DARK_INK,
  },
};

/**
 * The grain strength out of the box (polish design 3): a share of each board's `contrast`. The
 * owner found the grain most comfortable near the lowest setting of the comparison page.
 */
export const DEFAULT_GRAIN_STRENGTH = 0.35;

export type StyleChoice = { board: BoardId; stones: StoneId };

/** The sets of design 5.7 and the dark boards design, in the order the settings show them. */
export const SETS: StyleChoice[] = [
  { board: 'honey', stones: 'slate' },
  { board: 'kaya', stones: 'yunzi' },
  { board: 'walnut', stones: 'slate' },
  { board: 'printed', stones: 'flat' },
  { board: 'graphite', stones: 'flat' },
  { board: 'ink', stones: 'flat' },
];

export const sameStyle = (a: StyleChoice, b: StyleChoice) =>
  a.board === b.board && a.stones === b.stones;

/**
 * The style to draw in `theme`: the device's choice for it, or the default. A device that started in the phone
 * layout defaults to printed with flat stones (design 5.5); any other to honey with slate.
 */
export function effectiveStyle(
  device: Pick<DeviceSettings, 'boardStyles'>,
  startedNarrow: boolean,
  theme: Theme,
): StyleChoice {
  const chosen = device.boardStyles[theme];
  if (chosen) return chosen;
  return startedNarrow ? SETS[3] : SETS[0];
}
