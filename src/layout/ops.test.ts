import { describe, expect, it } from 'vitest';
import { type Layout, type Node, type SplitNode } from './model';
import { evenSplit, hidePanel, movePanel, resize, selectTab, showPanel } from './ops';
import { presetLayout } from './presets';

/** The tree as nested arrays of panel ids, for readable expectations. */
function shape(node: Node): unknown {
  if (node.type === 'board') return 'board';
  if (node.type === 'panel')
    return node.panel.kind === 'subboard' ? `sub${node.panel.rank}` : node.panel.kind;
  if (node.type === 'tabs') return { tabs: node.panels.map((p) => p.kind), active: node.active };
  return { [node.dir]: node.children.map(shape) };
}
const def = () => presetLayout('default');

describe('movePanel', () => {
  it('moving to an edge splits in that direction', () => {
    const next = movePanel(
      def(),
      { kind: 'trend' },
      {
        kind: 'split',
        target: { kind: 'candidates' },
        side: 'left',
      },
    );
    expect(next.preset).toBe('custom');
    expect(shape(next.root)).toEqual({
      row: ['board', { column: ['header', 'winrate', { row: ['trend', 'candidates'] }] }],
    });
  });

  it('moving to an edge in the same direction adds a sibling', () => {
    const next = movePanel(
      def(),
      { kind: 'trend' },
      {
        kind: 'split',
        target: { kind: 'candidates' },
        side: 'bottom',
      },
    );
    expect(shape(next.root)).toEqual({
      row: ['board', { column: ['header', 'winrate', 'candidates', 'trend'] }],
    });
  });

  it('moving to the middle makes tabs', () => {
    const next = movePanel(
      def(),
      { kind: 'trend' },
      { kind: 'tab', target: { kind: 'candidates' } },
    );
    expect(shape(next.root)).toEqual({
      row: [
        'board',
        { column: ['header', 'winrate', { tabs: ['candidates', 'trend'], active: 1 }] },
      ],
    });
  });

  it('dropping on the board edge adds a column', () => {
    const next = movePanel(def(), { kind: 'trend' }, { kind: 'column', side: 'left' });
    expect(shape(next.root)).toEqual({
      row: ['trend', 'board', { column: ['header', 'winrate', 'candidates'] }],
    });
  });

  it('moving the last panel out removes its column', () => {
    const withLeft = movePanel(def(), { kind: 'trend' }, { kind: 'column', side: 'left' });
    const back = movePanel(
      withLeft,
      { kind: 'trend' },
      {
        kind: 'split',
        target: { kind: 'candidates' },
        side: 'top',
      },
    );
    expect(shape(back.root)).toEqual({
      row: ['board', { column: ['header', 'winrate', 'trend', 'candidates'] }],
    });
  });

  it('a null drop changes nothing', () => {
    const layout = def();
    expect(movePanel(layout, { kind: 'trend' }, null)).toBe(layout);
  });

  it('a panel cannot become a tab with the header', () => {
    const next = movePanel(def(), { kind: 'trend' }, { kind: 'tab', target: { kind: 'header' } });
    expect(shape(next.root)).toEqual({
      row: ['board', { column: ['header', 'trend', 'winrate', 'candidates'] }],
    });
  });
});

describe('resize and evenSplit', () => {
  const column = (l: Layout) => l.root.children[1] as SplitNode;

  it('resize moves weight between neighbours', () => {
    // trend (index 2) and candidates (index 3) share 300 px as 1 : 2.
    const next = resize(def(), [1], 2, 30, [100, 200], [120, 160]);
    const [, , trend, candidates] = column(next).weights;
    expect(trend / (trend + candidates)).toBeCloseTo(130 / 300);
    expect(next.preset).toBe('custom');
  });

  it('resize respects minimum sizes', () => {
    const next = resize(def(), [1], 2, -500, [100, 200], [120, 160]);
    const [, , trend, candidates] = column(next).weights;
    expect(trend / (trend + candidates)).toBeCloseTo(120 / 300);
  });

  it('evenSplit evens two neighbours', () => {
    const next = evenSplit(def(), [1], 2);
    const [, , trend, candidates] = column(next).weights;
    expect(trend).toBeCloseTo(candidates);
  });
});

describe('hide and show', () => {
  it('hide then show returns the panel beside its neighbour', () => {
    const hidden = hidePanel(def(), { kind: 'trend' });
    expect(shape(hidden.root)).toEqual({
      row: ['board', { column: ['header', 'winrate', 'candidates'] }],
    });
    expect(hidden.hidden).toEqual([
      { panel: { kind: 'trend' }, besides: { kind: 'winrate' }, side: 'after' },
    ]);
    const shown = showPanel(hidden, { kind: 'trend' });
    expect(shape(shown.root)).toEqual({
      row: ['board', { column: ['header', 'winrate', 'trend', 'candidates'] }],
    });
    expect(shown.hidden).toEqual([]);
  });

  it('show after the neighbour is gone appends to the header column', () => {
    const one = hidePanel(def(), { kind: 'trend' });
    const two = hidePanel(one, { kind: 'winrate' });
    const shown = showPanel(two, { kind: 'trend' });
    expect(shape(shown.root)).toEqual({
      row: ['board', { column: ['header', 'candidates', 'trend'] }],
    });
  });

  it('showing a panel that was never in the layout appends it', () => {
    const shown = showPanel(def(), { kind: 'subboard', rank: 1 });
    expect(shape(shown.root)).toEqual({
      row: ['board', { column: ['header', 'winrate', 'trend', 'candidates', 'sub1'] }],
    });
  });

  it('the header cannot be hidden', () => {
    const layout = def();
    expect(hidePanel(layout, { kind: 'header' })).toBe(layout);
  });
});

describe('selectTab', () => {
  it('makes a tab active', () => {
    const tabs = movePanel(
      def(),
      { kind: 'trend' },
      { kind: 'tab', target: { kind: 'candidates' } },
    );
    const next = selectTab(tabs, { kind: 'candidates' });
    expect(shape(next.root)).toMatchObject({
      row: [
        'board',
        { column: ['header', 'winrate', { tabs: ['candidates', 'trend'], active: 0 }] },
      ],
    });
  });
});
