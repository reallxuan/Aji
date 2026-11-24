import {
  panelsOf,
  type Layout,
  type Node,
  type PanelRef,
  type PresetId,
  type SplitNode,
} from './model';

export const PRESET_IDS: readonly PresetId[] = [
  'default',
  'classic',
  'minimal',
  'thinking',
  'four',
];

/**
 * Weights that sum to 1. Any weight that is not a positive number makes them all equal. Weights
 * already within a rounding error of 1 are kept as they are, so normalising twice changes nothing.
 */
export function normalise(weights: readonly unknown[]): number[] {
  const valid = weights.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0);
  if (!valid) return weights.map(() => 1 / weights.length);
  const ws = weights as number[];
  const sum = ws.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) < 1e-9 ? [...ws] : ws.map((w) => w / sum);
}

const p = (kind: PanelRef['kind'], extra: Omit<PanelRef, 'kind'> = {}): Node => ({
  type: 'panel',
  panel: { kind, ...extra },
});
const split = (
  dir: 'row' | 'column',
  children: Node[],
  weights: number[] = children.map(() => 1),
  cap?: number,
): SplitNode => ({
  type: 'split',
  dir,
  children,
  weights: normalise(weights),
  ...(cap === undefined ? {} : { cap }),
});
function tabs(kinds: PanelRef['kind'][], active?: PanelRef['kind']): Node {
  return kinds.length === 1
    ? p(kinds[0])
    : {
        type: 'tabs',
        panels: kinds.map((kind) => ({ kind })),
        active: Math.max(
          0,
          kinds.findIndex((kind) => kind === active),
        ),
      };
}

const BOARD: Node = { type: 'board' };
const layout = (preset: PresetId, root: SplitNode, lines: Layout['lines'] = 'board'): Layout => ({
  version: 1,
  preset,
  root,
  hidden: [],
  lines,
});

/** The five presets, including the M3 record panels. */
export function presetLayout(id: PresetId): Layout {
  switch (id) {
    case 'default':
      return layout(
        'default',
        split('row', [
          BOARD,
          split(
            'column',
            [
              p('header'),
              p('winrate'),
              p('trend'),
              tabs(['candidates', 'swings', 'comments', 'tree']),
            ],
            [1, 1, 1, 2],
          ),
        ]),
      );
    case 'classic':
      return layout(
        'classic',
        split('row', [
          split('column', [p('winrate'), p('trend'), tabs(['tree', 'comments'])]),
          BOARD,
          split('column', [p('header'), p('candidates'), p('subboard', { rank: 1 })]),
        ]),
      );
    case 'minimal':
      return layout(
        'minimal',
        split('row', [
          BOARD,
          split(
            'column',
            [p('header'), p('winrate'), p('candidates', { maxRows: 3 })],
            undefined,
            312,
          ),
        ]),
      );
    case 'thinking':
      return layout(
        'thinking',
        split('row', [
          BOARD,
          split(
            'column',
            [p('header'), p('subboard', { rank: 1 }), p('winrate'), p('candidates')],
            [1, 3, 1, 1],
          ),
        ]),
        'subboard',
      );
    case 'four':
      return layout(
        'four',
        split('row', [
          BOARD,
          split('column', [
            p('header'),
            split('row', [p('subboard', { rank: 1 }), p('subboard', { rank: 2 })]),
            split('row', [p('subboard', { rank: 3 }), split('column', [p('winrate'), p('trend')])]),
          ]),
        ]),
      );
  }
}

/**
 * The untouched default on a wide window (design 5.2): the header over two columns, the analysis
 * on the left and the record on the right. Older saved layouts keep their panel membership.
 */
export function wideDefaultLayout(base: Layout = presetLayout('default')): Layout {
  const shown = panelsOf(base.root).map((p) => p.kind);
  const column = base.root.children[1];
  const group = column?.type === 'split' && column.children.find((c) => c.type === 'tabs');
  const active = group && group.type === 'tabs' ? group.panels[group.active]?.kind : undefined;
  const analysis = tabs(
    shown.includes('swings') ? ['candidates', 'swings'] : ['candidates'],
    base.wideTabs?.analysis ?? active,
  );
  const record = (['tree', 'comments'] as const).filter((kind) => shown.includes(kind));
  const subboard = p('subboard', { rank: 1 });
  return layout(
    'default',
    split('row', [
      BOARD,
      split('column', [
        p('header'),
        split('row', [
          split('column', [p('winrate'), p('trend'), analysis], [1, 1, 2]),
          record.length
            ? split('column', [tabs(record, base.wideTabs?.record ?? active), subboard], [2, 1])
            : subboard,
        ]),
      ]),
    ]),
  );
}
