import type { Color } from '../transport/generated/Color';
import type { Mark } from '../transport/generated/Mark';
import type { MarkupTool } from '../edit/modeStore';
import type { BoardView } from './drawBoard';
import { gridPosition, boardGeometry } from './geometry';
import { BOARD_STYLES } from './styles';
import type { MarkAt } from '../transport/generated/MarkAt';
import { branchLetter } from './badges';

/** Select the first unused label on the node, including labels loaded from its SGF. */
export function nextLabel(marks: readonly MarkAt[], kind: 'letter' | 'number'): string {
  const used = new Set(marks.flatMap(({ mark }) => (mark.kind === 'label' ? [mark.text] : [])));
  for (let i = 0; ; i++) {
    const text = kind === 'letter' ? branchLetter(i) : String(i + 1);
    if (!used.has(text)) return text;
  }
}

export function toggledMark(
  marks: readonly MarkAt[],
  existing: Mark | undefined,
  tool: Exclude<MarkupTool, 'freehand'>,
): Mark | null {
  if (tool === 'letter' || tool === 'number') {
    const pattern = tool === 'letter' ? /^[A-Z]+$/ : /^[1-9][0-9]*$/;
    if (existing?.kind === 'label' && pattern.test(existing.text)) return null;
    return { kind: 'label', text: nextLabel(marks, tool) };
  }
  return existing?.kind === tool ? null : { kind: tool };
}

export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly MarkAt[],
  view: BoardView,
  stones: readonly (Color | null)[],
) {
  const geometry = boardGeometry(view.cssSize, view.boardSize, view.coordinates, view.orientation);
  const { spacing } = geometry;
  const wood = BOARD_STYLES[view.style ?? 'honey'];
  const s = spacing * 0.3;
  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.cssSize, view.cssSize);
  ctx.lineWidth = 1.7;
  for (const { point, mark } of marks) {
    const { x, y } = gridPosition(geometry, point);
    const stone = stones[point.y * view.boardSize + point.x];
    const ink = stone === 'black' ? '#f2f0ea' : stone === 'white' ? '#1a1a1a' : wood.ink.mark;
    ctx.strokeStyle = ink;
    ctx.beginPath();
    switch (mark.kind) {
      case 'triangle':
        ctx.moveTo(x, y - s);
        ctx.lineTo(x + s * 0.9, y + s * 0.6);
        ctx.lineTo(x - s * 0.9, y + s * 0.6);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'square':
        ctx.strokeRect(x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5);
        break;
      case 'circle':
        ctx.arc(x, y, s * 0.8, 0, 2 * Math.PI);
        ctx.stroke();
        break;
      case 'cross':
        ctx.moveTo(x - s * 0.7, y - s * 0.7);
        ctx.lineTo(x + s * 0.7, y + s * 0.7);
        ctx.moveTo(x + s * 0.7, y - s * 0.7);
        ctx.lineTo(x - s * 0.7, y + s * 0.7);
        ctx.stroke();
        break;
      case 'label':
        if (!stone) {
          ctx.fillStyle = wood.base;
          ctx.arc(x, y, spacing * 0.36, 0, 2 * Math.PI);
          ctx.fill();
        }
        ctx.fillStyle = ink;
        ctx.font = `600 ${spacing * 0.5}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(mark.text, x, y + 1, spacing * 0.7);
    }
  }
  ctx.restore();
}
