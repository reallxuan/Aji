// Values fixed by the P2 M1 design (docs/superpowers/specs/2026-11-21-p2-m1-layout-design.md).
import type { PanelKind } from './model';

/** Margin around the board on every side, in CSS px (interface design 4). */
export const BOARD_MARGIN = 16;
/** Below this the board does not shrink; the narrow arrangement takes over (design 5.1). */
export const BOARD_FLOOR = 320;
/** The wizard and settings column is at least this wide. */
export const SIDE_MIN_WIDTH = 360;
/** The untouched default splits its column in two above this width (design 5.2). */
export const TWO_COLUMN_WIDTH = 760;
/** The narrow arrangement shows one tab at a time and bottom navigation below this width. */
export const PHONE_WIDTH = 700;
/** The outer share of a panel's side that splits it; the middle makes tabs (design 5.3). */
export const EDGE_ZONE = 0.25;
/** The share of the board's width, at each side, that makes a new column. */
export const BOARD_EDGE_BAND = 1 / 8;
/** Hairline hit areas, in CSS px. */
export const HAIRLINE_HIT = 8;
export const HAIRLINE_HIT_COARSE = 20;
/** Touch targets in the narrow arrangement. */
export const TOUCH_TARGET = 44;
/** A swipe steps once per this many CSS px. */
export const SWIPE_STEP = 40;
/** Sub-boards follow a deepening line at most this often. */
export const SUBBOARD_FOLLOW_MS = 500;
/** A changed layout is saved this long after the last change. */
export const LAYOUT_SAVE_MS = 500;

/**
 * Each panel's minimum size. Header and win-rate bar keep their content's height; the others
 * share their column's height by weight, never below these.
 */
export const MIN_SIZES: Record<PanelKind, { width: number; height: number }> = {
  header: { width: 280, height: 56 },
  winrate: { width: 200, height: 44 },
  trend: { width: 240, height: 120 },
  candidates: { width: 260, height: 160 },
  swings: { width: 260, height: 160 },
  subboard: { width: 200, height: 220 },
};

/** Panels whose height is their content's, not a share of the column. */
export const FIXED_HEIGHT: ReadonlySet<PanelKind> = new Set(['header', 'winrate']);
