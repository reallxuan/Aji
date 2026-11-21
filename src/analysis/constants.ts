// Values fixed by the M7 design (docs/superpowers/specs/2026-11-21-m7-analysis-on-board-design.md).

/** At most this many candidates are shown, on the board and in the table. */
export const MAX_CANDIDATES = 10;
/** A candidate needs at least this share of the top candidate's visits to be shown. */
export const MIN_VISIT_SHARE = 0.02;
/** Win-rate loss for the side to move, in percentage points: under this is close. */
export const CLOSE_LOSS = 2;
/** Up to and including this loss is doubtful; over it is poor. */
export const DOUBTFUL_LOSS = 4;

/** A trend node is plotted once its position has this many visits. */
export const TREND_MIN_VISITS = 50;
/** The score axis is the first of these ranges, in points either way, that holds every lead. */
export const SCORE_RANGES = [10, 20, 40, 80, 160] as const;
/** The trend graph's height in pixels, and in a window shorter than `COMPACT_WINDOW_HEIGHT`. */
export const GRAPH_HEIGHT = 150;
export const GRAPH_HEIGHT_COMPACT = 100;
export const COMPACT_WINDOW_HEIGHT = 720;

/** A variation shows at most this many moves. */
export const MAX_VARIATION = 20;

/** A search catching up on a deeper cached one is shown at this opacity. */
export const CATCHING_UP_OPACITY = 0.6;
/** How long the catching-up fade back takes. */
export const CATCHING_UP_FADE_MS = 200;
/** Speed is measured over this window of updates. */
export const SPEED_WINDOW_MS = 1000;
/** The engine hover card opens after this delay. */
export const HOVER_CARD_DELAY_MS = 300;
