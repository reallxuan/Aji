import { describe, expect, it } from 'vitest';
import { MIN_SIZES } from './constants';
import { type Frame, layoutFrame } from './frameGeometry';
import type { Layout, PanelRef } from './model';
import { PRESET_IDS, presetLayout } from './presets';

const minSize = (ref: PanelRef) => MIN_SIZES[ref.kind];
const wide = (frame: Frame) => {
  if (frame.narrow) throw new Error('expected the wide arrangement');
  return frame;
};

describe('layoutFrame', () => {
  it('default at 1440x900 matches Phase 1', () => {
    const f = wide(layoutFrame(presetLayout('default'), 1440, 900, minSize));
    expect(f.board).toEqual({ x: 16, y: 16, width: 868, height: 868 });
    expect(f.columns).toEqual([{ index: 1, x: 900, width: 540 }]);
  });

  it('default at 1920x1080 has two columns', () => {
    const f = wide(layoutFrame(presetLayout('default'), 1920, 1080, minSize));
    expect(f.board.width).toBe(1048);
    expect(f.columns).toEqual([{ index: 1, x: 1080, width: 840 }]);
    const side = f.layout.root.children[1];
    // The header over a row of two columns: analysis left, the record right.
    expect(side.type === 'split' && side.dir).toBe('column');
    const row = side.type === 'split' ? side.children[1] : null;
    expect(row?.type === 'split' && row.dir).toBe('row');
  });

  it('a changed default does not split', () => {
    const custom: Layout = { ...presetLayout('default'), preset: 'custom' };
    const f = wide(layoutFrame(custom, 1920, 1080, minSize));
    expect(f.layout).toBe(custom);
  });

  it('classic puts the board between two columns', () => {
    const f = wide(layoutFrame(presetLayout('classic'), 1440, 900, minSize));
    expect(f.columns).toHaveLength(2);
    const [left, right] = f.columns;
    expect(left.x).toBe(0);
    expect(f.board.x).toBe(left.width + 16);
    expect(right.x).toBe(f.board.x + f.board.width + 16);
    expect(right.x + right.width).toBe(1440);
  });

  it('minimal caps its column and centres the board in the rest', () => {
    const f = wide(layoutFrame(presetLayout('minimal'), 1440, 900, minSize));
    expect(f.columns[0].width).toBe(312);
    expect(f.board.width).toBe(868);
    expect(f.board.x).toBe(16 + 114);
    expect(f.slot).toEqual({ x: 0, width: 1440 - 312 });
  });

  it('portrait is narrow', () => {
    expect(layoutFrame(presetLayout('default'), 768, 1024, minSize).narrow).toBe(true);
  });

  it('560x420 landscape is narrow', () => {
    expect(layoutFrame(presetLayout('default'), 560, 420, minSize).narrow).toBe(true);
  });

  it('columns and the board slot tile the window width', () => {
    for (const id of PRESET_IDS) {
      for (const [w, h] of [
        [1024, 700],
        [1440, 900],
        [2560, 1440],
      ]) {
        const f = wide(layoutFrame(presetLayout(id), w, h, minSize));
        const slots = [...f.columns.map((c) => ({ x: c.x, width: c.width })), f.slot].sort(
          (a, b) => a.x - b.x,
        );
        let x = 0;
        for (const s of slots) {
          expect(s.x, `${id} ${w}x${h}`).toBe(x);
          x += s.width;
        }
        expect(x, `${id} ${w}x${h}`).toBe(w);
        expect(f.board.width).toBeGreaterThanOrEqual(320);
      }
    }
  });

  it('hairlines sit between adjacent columns, not beside the board', () => {
    const base = presetLayout('default');
    const twoRight: Layout = {
      ...base,
      preset: 'custom',
      root: {
        ...base.root,
        children: [
          { type: 'board' },
          { type: 'panel', panel: { kind: 'header' } },
          { type: 'panel', panel: { kind: 'trend' } },
        ],
        weights: [1 / 3, 1 / 3, 1 / 3],
      },
    };
    const f = wide(layoutFrame(twoRight, 1600, 900, minSize));
    expect(f.hairlines).toEqual([{ left: f.columns[0], right: f.columns[1] }]);
  });
});
