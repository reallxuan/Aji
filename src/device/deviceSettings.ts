import type { Color } from '../transport/generated/Color';
import type { DiscField } from '../transport/generated/DiscField';
import type { CandidateSort, CandidateSortKey } from '../analysis/sortCandidates';
import type { SwingBy } from '../analysis/swings';
import { MAX_VARIATION } from '../analysis/constants';
import { DEFAULT_GRAIN_STRENGTH } from '../board/styles';

export type BoardId = 'honey' | 'kaya' | 'walnut' | 'printed' | 'graphite' | 'ink';
export type StoneId = 'slate' | 'yunzi' | 'flat';
/** Maximum delay supported by a browser's signed 32-bit millisecond timer. */
export const MAX_REPLAY_SECONDS = 2147483647 / 1000;

export type InterfaceScale = 90 | 100 | 110 | 125 | 150;

export const BOARD_IDS: readonly BoardId[] = [
  'honey',
  'kaya',
  'walnut',
  'printed',
  'graphite',
  'ink',
];
export const STONE_IDS: readonly StoneId[] = ['slate', 'yunzi', 'flat'];
export const INTERFACE_SCALES: readonly InterfaceScale[] = [90, 100, 110, 125, 150];
const DISC_FIELDS: readonly DiscField[] = ['winrate', 'scoreLead', 'visits'];
const SORT_KEYS: readonly CandidateSortKey[] = ['rank', 'winrate', 'scoreLead', 'visits'];

/** How many candidates the board and the list show: `auto` is design 5.6's rule. */
export type CandidateCount = 'auto' | 5 | 10 | 'all';
export const CANDIDATE_COUNTS: readonly CandidateCount[] = ['auto', 5, 10, 'all'];
/** The moves a hovered line can show. */
export const LINE_LENGTHS: readonly number[] = [5, 10, 15, 20, 30];

/** The candidate list's optional columns; the chip and the point always stay. */
export interface CandidateColumns {
  winrate: boolean;
  scoreLead: boolean;
  visits: boolean;
  /** The share of visits, inside the 计算量 cell. */
  share: boolean;
  vsBest: boolean;
}

export interface MoveNumbers {
  mode: 'off' | 'all' | 'last';
  last: number;
  restartInBranch: boolean;
  lastOn: 'all' | 'last';
}

/**
 * Settings that belong to one device rather than to the engine side (P2 M1 design 5.8): a phone
 * and the desktop show the same engine differently.
 */
export interface DeviceSettings {
  moveNumbers: MoveNumbers;
  autoReplaySeconds: number;
  openAt: 'first' | 'last';
  version: 1;
  /** The stored layout, unchecked; the layout model validates it. */
  layout: unknown;
  /** The narrow arrangement's active tab. */
  narrowTab: string | null;
  /** Key chord to command id; empty until the shortcut editor (Phase 2 M4). */
  keymap: Record<string, string>;
  /** `null` is the default for the device (design 5.5). */
  boardStyle: { board: BoardId; stones: StoneId } | null;
  /** The wood boards' grain, 0 (none) to 1 (UI polish design 3). */
  grainStrength: number;
  /**
   * Whether the device first launched in the phone layout, which picks the default style; `null`
   * until the first launch decides it, so the default never changes with a later window size.
   */
  startedNarrow: boolean | null;
  interfaceScale: InterfaceScale;
  showCoordinates: boolean;
  /** Two different fields, top line first. */
  discLines: [DiscField, DiscField];
  /** Whose numbers the trend graph shows; the discs and the table show the side to move's. */
  perspective: Color;
  /** Leads include komi (KataGo's), or count the board alone. */
  scoreWithKomi: boolean;
  alwaysOnTop: boolean;
  /** The candidate list (P2 M2 design 5.5). */
  candidateSort: CandidateSort;
  candidateColumns: CandidateColumns;
  candidateCount: CandidateCount;
  /** How many moves a hovered line shows. */
  lineLength: number;
  /** The swing list (P2 M2 design 5.4): by win rate or score, each with its own threshold. */
  swingBy: SwingBy;
  swingThreshold: { winrate: number; score: number };
  /** Only the moves after the current one. */
  swingAfterOnly: boolean;
  /** The three fields that used to live in the backend's settings have been copied. */
  migrated: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  version: 1,
  autoReplaySeconds: 1.5,
  openAt: 'first',
  moveNumbers: { mode: 'off', last: 10, restartInBranch: false, lastOn: 'all' },
  layout: null,
  narrowTab: null,
  keymap: {},
  boardStyle: null,
  grainStrength: DEFAULT_GRAIN_STRENGTH,
  startedNarrow: null,
  interfaceScale: 100,
  showCoordinates: true,
  discLines: ['winrate', 'scoreLead'],
  perspective: 'black',
  scoreWithKomi: true,
  alwaysOnTop: false,
  candidateSort: { key: 'rank', descending: true },
  candidateColumns: { winrate: true, scoreLead: true, visits: true, share: true, vsBest: false },
  candidateCount: 'auto',
  lineLength: MAX_VARIATION,
  swingBy: 'winrate',
  swingThreshold: { winrate: 5, score: 2 },
  swingAfterOnly: false,
  migrated: false,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T>(values: readonly T[], v: unknown): v is T => values.includes(v as T);

function parseNumbers(v: unknown, d: MoveNumbers): MoveNumbers {
  if (!isRecord(v)) return d;
  return {
    mode: oneOf<MoveNumbers['mode']>(['off', 'all', 'last'], v.mode) ? v.mode : d.mode,
    last:
      typeof v.last === 'number' && Number.isSafeInteger(v.last) && v.last > 0 ? v.last : d.last,
    lastOn: v.lastOn === 'last' ? 'last' : 'all',
    restartInBranch: v.restartInBranch === true,
  };
}

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

function parseSort(v: unknown): CandidateSort | undefined {
  if (!isRecord(v) || !oneOf(SORT_KEYS, v.key) || typeof v.descending !== 'boolean')
    return undefined;
  return { key: v.key, descending: v.descending };
}

function parseColumns(v: unknown, d: CandidateColumns): CandidateColumns {
  if (!isRecord(v)) return d;
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  return {
    winrate: bool(v.winrate, d.winrate),
    scoreLead: bool(v.scoreLead, d.scoreLead),
    visits: bool(v.visits, d.visits),
    share: bool(v.share, d.share),
    vsBest: bool(v.vsBest, d.vsBest),
  };
}

function parseThreshold(v: unknown, d: DeviceSettings['swingThreshold']) {
  if (!isRecord(v)) return d;
  const positive = (x: unknown, fallback: number) =>
    typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : fallback;
  return { winrate: positive(v.winrate, d.winrate), score: positive(v.score, d.score) };
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
    autoReplaySeconds:
      typeof raw.autoReplaySeconds === 'number' &&
      Number.isFinite(raw.autoReplaySeconds) &&
      raw.autoReplaySeconds > 0 &&
      raw.autoReplaySeconds <= MAX_REPLAY_SECONDS
        ? raw.autoReplaySeconds
        : d.autoReplaySeconds,
    openAt: raw.openAt === 'last' ? 'last' : 'first',
    moveNumbers: parseNumbers(raw.moveNumbers, d.moveNumbers),
    layout: raw.layout === undefined ? d.layout : raw.layout,
    narrowTab: typeof raw.narrowTab === 'string' ? raw.narrowTab : d.narrowTab,
    keymap: parseKeymap(raw.keymap) ?? d.keymap,
    boardStyle: parseBoardStyle(raw.boardStyle) ?? d.boardStyle,
    grainStrength:
      typeof raw.grainStrength === 'number' && raw.grainStrength >= 0 && raw.grainStrength <= 1
        ? raw.grainStrength
        : d.grainStrength,
    startedNarrow: typeof raw.startedNarrow === 'boolean' ? raw.startedNarrow : d.startedNarrow,
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
    candidateSort: parseSort(raw.candidateSort) ?? d.candidateSort,
    candidateColumns: parseColumns(raw.candidateColumns, d.candidateColumns),
    candidateCount: oneOf(CANDIDATE_COUNTS, raw.candidateCount)
      ? raw.candidateCount
      : d.candidateCount,
    lineLength:
      Number.isInteger(raw.lineLength) && (raw.lineLength as number) > 0
        ? (raw.lineLength as number)
        : d.lineLength,
    swingBy: oneOf<SwingBy>(['winrate', 'score'], raw.swingBy) ? raw.swingBy : d.swingBy,
    swingThreshold: parseThreshold(raw.swingThreshold, d.swingThreshold),
    swingAfterOnly: bool(raw.swingAfterOnly, d.swingAfterOnly),
    migrated: bool(raw.migrated, d.migrated),
  };
}
