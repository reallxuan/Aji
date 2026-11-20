/** Column letters as Go boards print them: I is skipped so it is never read as J or 1. */
const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRST';

/**
 * The margin outside the outermost lines, as a share of the board's CSS size. Taken from the
 * mockups: a 868 px board has its grid from 40 to 828.
 */
const MARGIN_SHARE = 40 / 868;

export interface BoardGeometry {
  /** CSS pixels from the board's edge to the outermost line. */
  margin: number;
  /** CSS pixels between neighbouring lines. */
  spacing: number;
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
  const margin = size * MARGIN_SHARE;
  const spacing = boardSize > 1 ? (size - 2 * margin) / (boardSize - 1) : 0;
  const lines = Array.from({ length: boardSize }, (_, i) => margin + i * spacing);
  return {
    margin,
    spacing,
    lines,
    stars: starPoints(boardSize),
    columns: lines.map((x, i) => ({ label: COLUMN_LETTERS[i] ?? '', x })),
    rows: lines.map((y, i) => ({ label: String(boardSize - i), y })),
  };
}
