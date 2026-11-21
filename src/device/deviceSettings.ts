import type { Color } from '../transport/generated/Color';
import type { DiscField } from '../transport/generated/DiscField';

export type BoardId = 'honey' | 'kaya' | 'walnut' | 'printed';
export type StoneId = 'slate' | 'yunzi' | 'flat';
export type InterfaceScale = 90 | 100 | 110 | 125 | 150;

export const BOARD_IDS: readonly BoardId[] = ['honey', 'kaya', 'walnut', 'printed'];
export const STONE_IDS: readonly StoneId[] = ['slate', 'yunzi', 'flat'];
export const INTERFACE_SCALES: readonly InterfaceScale[] = [90, 100, 110, 125, 150];
const DISC_FIELDS: readonly DiscField[] = ['winrate', 'scoreLead', 'visits'];

/**
 * Settings that belong to one device rather than to the engine side (P2 M1 design 5.8): a phone
 * and the desktop show the same engine differently.
 */
export interface DeviceSettings {
  version: 1;
  /** The stored layout, unchecked; the layout model validates it. */
  layout: unknown;
  /** The narrow arrangement's active tab. */
  narrowTab: string | null;
  /** Key chord to command id; empty until the shortcut editor (Phase 2 M4). */
  keymap: Record<string, string>;
  /** `null` is the default for the device (design 5.5). */
  boardStyle: { board: BoardId; stones: StoneId } | null;
  interfaceScale: InterfaceScale;
  showCoordinates: boolean;
  /** Two different fields, top line first. */
  discLines: [DiscField, DiscField];
  /** Whose numbers the trend graph shows; the discs and the table show the side to move's. */
  perspective: Color;
  /** Leads include komi (KataGo's), or count the board alone. */
  scoreWithKomi: boolean;
  alwaysOnTop: boolean;
  /** The three fields that used to live in the backend's settings have been copied. */
  migrated: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  version: 1,
  layout: null,
  narrowTab: null,
  keymap: {},
  boardStyle: null,
  interfaceScale: 100,
  showCoordinates: true,
  discLines: ['winrate', 'scoreLead'],
  perspective: 'black',
  scoreWithKomi: true,
  alwaysOnTop: false,
  migrated: false,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T>(values: readonly T[], v: unknown): v is T => values.includes(v as T);

function parseKeymap(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const entries = Object.entries(v);
  return entries.every(([, c]) => typeof c === 'string')
    ? (Object.fromEntries(entries) as Record<string, string>)
    : undefined;
}

function parseBoardStyle(v: unknown): DeviceSettings['boardStyle'] | undefined {
  if (v === null) return null;
  if (!isRecord(v) || !oneOf(BOARD_IDS, v.board) || !oneOf(STONE_IDS, v.stones)) return undefined;
  return { board: v.board, stones: v.stones };
}

function parseDiscLines(v: unknown): DeviceSettings['discLines'] | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const [a, b] = v;
  return oneOf(DISC_FIELDS, a) && oneOf(DISC_FIELDS, b) && a !== b ? [a, b] : undefined;
}

/**
 * Reads stored device settings field by field: a field that cannot be read takes its default and
 * the others stand. Anything that is not a version-1 object reads as the defaults. Never throws.
 */
export function parseDeviceSettings(raw: unknown): DeviceSettings {
  const d = DEFAULT_DEVICE_SETTINGS;
  if (!isRecord(raw) || raw.version !== 1) return d;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    version: 1,
    layout: raw.layout === undefined ? d.layout : raw.layout,
    narrowTab: typeof raw.narrowTab === 'string' ? raw.narrowTab : d.narrowTab,
    keymap: parseKeymap(raw.keymap) ?? d.keymap,
    boardStyle: parseBoardStyle(raw.boardStyle) ?? d.boardStyle,
    interfaceScale: oneOf(INTERFACE_SCALES, raw.interfaceScale)
      ? raw.interfaceScale
      : d.interfaceScale,
    showCoordinates: bool(raw.showCoordinates, d.showCoordinates),
    discLines: parseDiscLines(raw.discLines) ?? d.discLines,
    perspective: oneOf<Color>(['black', 'white'], raw.perspective)
      ? raw.perspective
      : d.perspective,
    scoreWithKomi: bool(raw.scoreWithKomi, d.scoreWithKomi),
    alwaysOnTop: bool(raw.alwaysOnTop, d.alwaysOnTop),
    migrated: bool(raw.migrated, d.migrated),
  };
}
