import { describe, expect, it } from 'vitest';
import type { Layout, Node } from './model';
import { PRESET_IDS, presetLayout } from './presets';
import { validateLayout } from './validate';

const panel = (kind: string, extra: object = {}) => ({ type: 'panel', panel: { kind, ...extra } });
const layoutWith = (children: unknown[], weights?: number[]) => ({
  version: 1,
  preset: 'custom',
  root: { type: 'split', dir: 'row', children, weights: weights ?? children.map(() => 1) },
  hidden: [],
  lines: 'board',
});
const column = (children: unknown[]) => ({
  type: 'split',
  dir: 'column',
  children,
  weights: children.map(() => 1),
});

/** Every panel ref in tree order, tabs included. */
function refs(node: Node): string[] {
  if (node.type === 'board') return ['board'];
  if (node.type === 'panel') return [node.panel.kind];
  if (node.type === 'tabs') return node.panels.map((p) => p.kind);
  return node.children.flatMap(refs);
}

describe('validateLayout', () => {
  it('every preset survives validation unchanged', () => {
    for (const id of PRESET_IDS) expect(validateLayout(presetLayout(id))).toEqual(presetLayout(id));
  });

  it('the default preset has 波动 as a tab beside 候选 (P2 M2 design 5.4)', () => {
    expect(refs(presetLayout('default').root)).toEqual([
      'board',
      'header',
      'winrate',
      'trend',
      'candidates',
      'swings',
    ]);
    for (const id of PRESET_IDS.filter((id) => id !== 'default')) {
      expect(refs(presetLayout(id).root)).not.toContain('swings');
    }
  });

  it('stored_layouts_without_swings_still_validate', () => {
    // A layout stored before M2: the M1 default, without 波动.
    const stored = {
      ...layoutWith([
        { type: 'board' },
        column([panel('header'), panel('winrate'), panel('trend'), panel('candidates')]),
      ]),
      preset: 'default',
    };
    const v = validateLayout(stored);
    expect(v.preset).toBe('default');
    expect(refs(v.root)).toEqual(['board', 'header', 'winrate', 'trend', 'candidates']);
    // And a stored 波动 is a known panel.
    const withSwings = validateLayout(
      layoutWith([{ type: 'board' }, column([panel('header'), panel('swings')])]),
    );
    expect(refs(withSwings.root)).toEqual(['board', 'header', 'swings']);
  });

  it('unknown kinds and duplicates are dropped', () => {
    const v = validateLayout(
      layoutWith([
        { type: 'board' },
        column([panel('header'), panel('mystery'), panel('trend'), panel('trend')]),
      ]),
    );
    expect(refs(v.root)).toEqual(['board', 'header', 'trend']);
  });

  it('a second sub-board of another rank is not a duplicate', () => {
    const v = validateLayout(
      layoutWith([
        { type: 'board' },
        column([panel('header'), panel('subboard', { rank: 1 }), panel('subboard', { rank: 2 })]),
      ]),
    );
    expect(refs(v.root)).toEqual(['board', 'header', 'subboard', 'subboard']);
  });

  it('a layout without the board is the default', () => {
    expect(validateLayout(layoutWith([column([panel('header')])]))).toEqual(
      presetLayout('default'),
    );
  });

  it('a layout without the header is the default', () => {
    expect(validateLayout(layoutWith([{ type: 'board' }, column([panel('trend')])]))).toEqual(
      presetLayout('default'),
    );
  });

  it('a board inside a column is not the board', () => {
    expect(validateLayout(layoutWith([column([panel('header'), { type: 'board' }])]))).toEqual(
      presetLayout('default'),
    );
  });

  it('version 2 is the default', () => {
    expect(validateLayout({ ...presetLayout('classic'), version: 2 })).toEqual(
      presetLayout('default'),
    );
  });

  it('weights are normalised', () => {
    const v = validateLayout(
      layoutWith(
        [{ type: 'board' }, column([panel('header')]), column([panel('trend')])],
        [1, 3, 1],
      ),
    );
    expect(v.root.weights).toEqual([0.2, 0.6, 0.2]);
    const bad = validateLayout(
      layoutWith([{ type: 'board' }, column([panel('header')])], [Number.NaN, -1]),
    );
    expect(bad.root.weights).toEqual([0.5, 0.5]);
  });

  it('a split left with one child collapses', () => {
    const v = validateLayout(
      layoutWith([{ type: 'board' }, column([panel('header'), column([panel('trend')])])]),
    );
    const side = v.root.children[1];
    expect(side.type === 'split' && side.children[1]).toEqual({
      type: 'panel',
      panel: { kind: 'trend' },
    });
  });

  it('empty tabs go and single tabs become panels, with active clamped', () => {
    const v = validateLayout(
      layoutWith([
        { type: 'board' },
        column([
          panel('header'),
          { type: 'tabs', panels: [], active: 0 },
          { type: 'tabs', panels: [{ kind: 'trend' }, { kind: 'candidates' }], active: 9 },
          { type: 'tabs', panels: [{ kind: 'winrate' }], active: 0 },
        ]),
      ]),
    );
    const side = v.root.children[1];
    if (side.type !== 'split') throw new Error('expected a column');
    expect(side.children).toEqual([
      { type: 'panel', panel: { kind: 'header' } },
      { type: 'tabs', panels: [{ kind: 'trend' }, { kind: 'candidates' }], active: 1 },
      { type: 'panel', panel: { kind: 'winrate' } },
    ]);
  });

  it('a hidden panel that is also shown is not hidden, and bad hidden entries go', () => {
    const v = validateLayout({
      ...layoutWith([{ type: 'board' }, column([panel('header'), panel('trend')])]),
      hidden: [
        { panel: { kind: 'trend' }, besides: null, side: 'after' },
        { panel: { kind: 'candidates' }, besides: { kind: 'header' }, side: 'after' },
        { panel: { kind: 'header' }, besides: null, side: 'after' },
        { panel: { kind: 'nope' }, besides: null, side: 'after' },
      ],
    });
    expect(v.hidden).toEqual([
      { panel: { kind: 'candidates' }, besides: { kind: 'header' }, side: 'after' },
    ]);
  });

  it('random json never throws', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
    const junk = (depth: number): unknown => {
      const r = random();
      if (depth > 3 || r < 0.2) return pick([null, 1, 'x', [], {}, { type: 'board' }]);
      if (r < 0.5)
        return panel(pick(['header', 'trend', 'subboard', 'bad']), { rank: pick([1, 4, 'a']) });
      if (r < 0.6)
        return { type: 'tabs', panels: [{ kind: 'trend' }, 3], active: pick([0, -1, 'z']) };
      const children = Array.from({ length: Math.floor(random() * 4) }, () => junk(depth + 1));
      return {
        type: 'split',
        dir: pick(['row', 'column', 'diagonal']),
        children,
        weights: pick([[], [1, 'a'], null]),
      };
    };
    for (let i = 0; i < 200; i++) {
      const raw = { version: 1, preset: 'custom', root: junk(0), hidden: junk(2), lines: 'x' };
      const v: Layout = validateLayout(raw);
      expect(v.root.type).toBe('split');
      expect(refs(v.root).filter((r) => r === 'board')).toHaveLength(1);
      expect(refs(v.root)).toContain('header');
    }
  });
});
