import { BOARD_MARGIN } from './constants';

export { BOARD_MARGIN };
/** The panel never gets narrower than this while the board can still shrink. */
export const PANEL_MIN_WIDTH = 360;

export type Frame = {
  board: { x: number; y: number; size: number };
  panel: { x: number; width: number };
};

/**
 * The board is a square sized by the window height; the panel takes the rest of the width.
 * On narrow windows the board shrinks first so the panel keeps its minimum width.
 */
export function computeFrame(width: number, height: number): Frame {
  const size = Math.max(
    0,
    Math.floor(Math.min(height - 2 * BOARD_MARGIN, width - 2 * BOARD_MARGIN - PANEL_MIN_WIDTH)),
  );
  const panelX = size + 2 * BOARD_MARGIN;
  return {
    board: { x: BOARD_MARGIN, y: BOARD_MARGIN, size },
    panel: { x: panelX, width: width - panelX },
  };
}
