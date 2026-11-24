import type { Continuation } from '../transport/generated/Continuation';
import type { Color } from '../transport/generated/Color';
import type { Move } from '../transport/generated/Move';
import type { Point } from '../transport/generated/Point';
import type { BoardView } from './drawBoard';
import { boardGeometry, type BoardGeometry } from './geometry';

export interface Badge {
  point: Point;
  letter: string;
  tryout: boolean;
  outlined: boolean;
}
export type StoneNumber = { point: Point; n: number };

/** A through Z, then AA, AB, ...; passes and setup children keep their slots in the tree. */
export function branchLetter(index: number): string {
  let letter = '';
  for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26))
    letter = String.fromCharCode(65 + ((i - 1) % 26)) + letter;
  return letter;
}

export function badgesFor(
  continuations: readonly Continuation[],
  candidates: ReadonlyArray<{ move: Move }>,
): Badge[] {
  if (continuations.length < 2) return [];
  return continuations.flatMap(({ mv, tryout }, index) => {
    if (mv?.type !== 'play') return [];
    const outlined = !candidates.some(
      ({ move }) => move.type === 'play' && move.x === mv.x && move.y === mv.y,
    );
    return [{ point: { x: mv.x, y: mv.y }, letter: branchLetter(index), tryout, outlined }];
  });
}

function badgeBox(g: BoardGeometry, point: Point) {
  return {
    x: g.lines[point.x] + 0.22 * g.spacing,
    y: g.lines[point.y] - 0.62 * g.spacing,
    size: 0.4 * g.spacing,
  };
}

export function badgeAt(g: BoardGeometry, badges: readonly Badge[], x: number, y: number) {
  return badges.find(({ point }) => {
    const b = badgeBox(g, point);
    return x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size;
  });
}

export function drawEditOverlay(
  ctx: CanvasRenderingContext2D,
  view: BoardView,
  stones: readonly (Color | null)[],
  badges: readonly Badge[],
  tryout: readonly StoneNumber[],
  numbers: readonly StoneNumber[] = [],
) {
  const g = boardGeometry(view.cssSize, view.boardSize, view.coordinates);
  if (g.spacing <= 0) return;
  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.cssSize, view.cssSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const s = g.spacing;
  const amber = '#e2a33b';
  const number = ({ point, n }: StoneNumber) => {
    ctx.fillStyle = stones[point.y * view.boardSize + point.x] === 'black' ? '#f2f0ea' : '#1a1a1a';
    ctx.font = `600 ${s * 0.42}px Inter`;
    ctx.fillText(String(n), g.lines[point.x], g.lines[point.y] + 0.5);
  };
  numbers.forEach(number);
  for (const entry of tryout) {
    const { point } = entry;
    ctx.strokeStyle = amber;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2.5, 2]);
    ctx.beginPath();
    ctx.arc(g.lines[point.x], g.lines[point.y], s * 0.56, 0, Math.PI * 2);
    ctx.stroke();
    number(entry);
  }
  ctx.setLineDash([]);
  // Siblings can record the same move. A single plus-marked badge opens their chooser.
  const byPoint = new Map<number, Badge[]>();
  for (const b of badges) {
    const key = b.point.y * view.boardSize + b.point.x;
    const group = byPoint.get(key);
    if (group) group.push(b);
    else byPoint.set(key, [b]);
  }
  for (const group of byPoint.values()) {
    const b = group[0];
    const tryout = group.some((choice) => choice.tryout);
    if (b.outlined) {
      ctx.strokeStyle = view.style === 'walnut' ? '#f3efe4' : 'rgba(43,29,14,.7)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(g.lines[b.point.x], g.lines[b.point.y], s * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
    const { x, y, size } = badgeBox(g, b.point);
    ctx.fillStyle = tryout ? amber : '#1f1a14';
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, size * 0.22);
    ctx.fill();
    ctx.fillStyle = tryout ? '#1f1a14' : '#f3efe4';
    ctx.font = `700 ${size * 0.72}px Inter`;
    ctx.fillText(
      group.length > 1 ? `${b.letter}+` : b.letter,
      x + size / 2,
      y + size / 2 + 0.5,
      size * 0.95,
    );
  }
  ctx.restore();
}
