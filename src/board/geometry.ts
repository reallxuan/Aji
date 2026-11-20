/** Column letters as Go boards print them: I is skipped so it is never read as J or 1. */
const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRST';

/** A stone's radius as a share of the line spacing: stones are 0.96 of it across (design 5.9). */
export const STONE_RADIUS_SHARE = 0.48;

/**
 * The band for the coordinates, between the board's edge and a stone on the outermost line, as
 * a share of the board's CSS size. Chosen so a 868 px 19×19 board has its grid from 40 to 828,
 * as in the mockups; other sizes keep the same band, so edge stones never cover a coordinate or
 * hang over the wood.
 */
const LABEL_BAND_SHARE = (40 - (STONE_RADIUS_SHARE * 788) / 18) / 868;
/** On small boards the band keeps room for legible coordinates, up to a twentieth of the board. */
const MIN_LABEL_BAND = 12;

export interface BoardGeometry {
  /** CSS pixels from the board's edge to the outermost line. */
  margin: number;
  /** CSS pixels between neighbouring lines. */
  spacing: number;
  /** A stone's radius in CSS pixels. */
  stoneRadius: number;
  /** CSS pixels from the board's edge to an edge stone: where the coordinates go. */
  labelBand: number;
  /** The position of each line, the same for columns (x) and rows (y), first line first. */
  lines: number[];
  /** Star points as [column index, row index], both counted from the top-left corner. */
  stars: Array<[number, number]>;
  columns: Array<{ label: string; x: number }>;
  /** Rows from the top: the top row carries the highest number. */
  rows: Array<{ label: string; y: number }>;
}

/** The line indices star points sit on: the 4-4 points (3-3 on small boards) and the centre. */
function starLines(boardSize: number): number[] {
  if (boardSize < 7) return [];
  const corner = boardSize >= 13 ? 3 : 2;
  const far = boardSize - 1 - corner;
  const centre = (boardSize - 1) / 2;
  if (boardSize % 2 === 0) return [corner, far];
  return boardSize >= 19 ? [corner, centre, far] : [corner, far, centre];
}

function starPoints(boardSize: number): Array<[number, number]> {
  const lines = starLines(boardSize);
  if (lines.length === 0) return [];
  // 19×19 and larger get all nine; smaller odd boards get the four corners and the centre.
  if (boardSize >= 19)
    return lines.flatMap((col) => lines.map((row): [number, number] => [col, row]));
  const [low, high] = lines;
  const points: Array<[number, number]> = [
    [low, low],
    [low, high],
    [high, low],
    [high, high],
  ];
  if (lines.length === 3) points.push([lines[2], lines[2]]);
  return points;
}

/** Lays out the grid for a square board area of `cssSize` CSS pixels. Pure. */
export function boardGeometry(cssSize: number, boardSize: number): BoardGeometry {
  const size = Math.max(0, cssSize);
  const labelBand = Math.min(size * 0.05, Math.max(size * LABEL_BAND_SHARE, MIN_LABEL_BAND));
  // size = 2 × (band + radius) + (lines − 1) × spacing, with radius = share × spacing.
  const spacing =
    boardSize > 1 ? (size - 2 * labelBand) / (boardSize - 1 + 2 * STONE_RADIUS_SHARE) : 0;
  const stoneRadius = spacing * STONE_RADIUS_SHARE;
  const margin = labelBand + stoneRadius;
  const lines = Array.from({ length: boardSize }, (_, i) => margin + i * spacing);
  return {
    margin,
    spacing,
    stoneRadius,
    labelBand,
    lines,
    stars: starPoints(boardSize),
    columns: lines.map((x, i) => ({ label: COLUMN_LETTERS[i] ?? '', x })),
    rows: lines.map((y, i) => ({ label: String(boardSize - i), y })),
  };
}
