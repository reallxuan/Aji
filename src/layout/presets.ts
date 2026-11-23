import type { Layout, Node, PanelRef, PresetId, SplitNode } from './model';

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
const BOARD: Node = { type: 'board' };
const layout = (preset: PresetId, root: SplitNode, lines: Layout['lines'] = 'board'): Layout => ({
  version: 1,
  preset,
  root,
  hidden: [],
  lines,
});

/** The five presets of design 5.2 (Classic as M1 builds it, until comments arrive in M3). */
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
              // 波动 is a tab beside 候选 (P2 M2 design 5.4).
              { type: 'tabs', panels: [{ kind: 'candidates' }, { kind: 'swings' }], active: 0 },
            ],
            [1, 1, 1, 2],
          ),
        ]),
      );
    case 'classic':
      return layout(
        'classic',
        split('row', [
          // The bar and the graph on the left, which leaves room for more later; the candidates
          // above the sub-board on the right (owner, 2026-11-22).
          split('column', [p('winrate'), p('trend')]),
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
 * on the left and the record on the right. In M1 the record column holds the sub-board.
 */
export function wideDefaultLayout(): Layout {
  return layout(
    'default',
    split('row', [
      BOARD,
      split('column', [
        p('header'),
        split('row', [
          split('column', [p('winrate'), p('trend'), p('candidates')], [1, 1, 2]),
          split('column', [p('subboard', { rank: 1 })]),
        ]),
      ]),
    ]),
  );
}
