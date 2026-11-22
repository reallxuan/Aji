import { describe, expect, it } from 'vitest';
import { dropTarget } from './dropTarget';
import type { PanelRef } from './model';

const board = { x: 16, y: 16, width: 800, height: 800 };
const rects = [
  { ref: { kind: 'header' as const }, rect: { x: 900, y: 0, width: 400, height: 56 } },
  { ref: { kind: 'trend' as const }, rect: { x: 900, y: 56, width: 400, height: 200 } },
  { ref: { kind: 'candidates' as const }, rect: { x: 900, y: 256, width: 400, height: 400 } },
];
const at = (x: number, y: number, dragged: PanelRef = { kind: 'trend' }) =>
  dropTarget(rects, board, { x, y }, dragged);

describe('dropTarget', () => {
  it('edge quarter and middle', () => {
    expect(at(910, 456, { kind: 'trend' })).toEqual({
      kind: 'split',
      target: { kind: 'candidates' },
      side: 'left',
    });
    expect(at(1100, 640)).toEqual({
      kind: 'split',
      target: { kind: 'candidates' },
      side: 'bottom',
    });
    expect(at(1100, 456)).toEqual({ kind: 'tab', target: { kind: 'candidates' } });
  });

  it('the header takes no tabs: its middle splits by the nearest edge', () => {
    expect(at(1100, 20, { kind: 'candidates' })).toEqual({
      kind: 'split',
      target: { kind: 'header' },
      side: 'top',
    });
  });

  it('board band and board middle', () => {
    expect(at(40, 400)).toEqual({ kind: 'column', side: 'left' });
    expect(at(800, 400)).toEqual({ kind: 'column', side: 'right' });
    expect(at(400, 400)).toBeNull();
  });

  it('over itself is null, and nowhere is null', () => {
    expect(at(1100, 150, { kind: 'trend' })).toBeNull();
    expect(at(1100, 800)).toBeNull();
  });
});
