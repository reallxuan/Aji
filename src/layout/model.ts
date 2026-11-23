/**
 * The layout model (P2 M1 design 5.1): a tree of splits and tab groups around the board, stored
 * per device. Panels are named by kind (and, for sub-boards, rank), never by component.
 */

export type PanelKind = 'header' | 'winrate' | 'trend' | 'candidates' | 'swings' | 'subboard';
export const PANEL_KINDS: readonly PanelKind[] = [
  'header',
  'winrate',
  'trend',
  'candidates',
  'swings',
  'subboard',
];

export type PanelRef = {
  kind: PanelKind;
  /** A sub-board's candidate: 1 is the best. Only sub-boards carry it. */
  rank?: 1 | 2 | 3;
  /** A list panel's row limit (Minimal's candidates). */
  maxRows?: number;
};

export type SplitNode = {
  type: 'split';
  dir: 'row' | 'column';
  children: Node[];
  /** One per child, summing to 1. In the root row, the board's weight is ignored. */
  weights: number[];
  /** The widest a root column may grow, in CSS px; the rest becomes margin around the board. */
  cap?: number;
};

export type Node =
  | { type: 'board' }
  | { type: 'panel'; panel: PanelRef }
  | { type: 'tabs'; panels: PanelRef[]; active: number }
  | SplitNode;

/** A hidden panel, and the panel it goes back beside when shown again. */
export type Hidden = { panel: PanelRef; besides: PanelRef | null; side: 'before' | 'after' };

export type PresetId = 'default' | 'classic' | 'minimal' | 'thinking' | 'four';

export type Layout = {
  version: 1;
  preset: PresetId | 'custom';
  /** A row holding the board exactly once, with columns on either side. */
  root: SplitNode;
  hidden: Hidden[];
  /** Where a hovered candidate's line is drawn: the main board, or the first sub-board. */
  lines: 'board' | 'subboard';
};

/** A panel's identity: kind, plus rank for sub-boards. `maxRows` is an option, not identity. */
export function refId(ref: PanelRef): string {
  return ref.kind === 'subboard' ? `subboard:${ref.rank ?? 1}` : ref.kind;
}

export function sameRef(a: PanelRef, b: PanelRef): boolean {
  return refId(a) === refId(b);
}

/** Every panel shown in a tree, in order, tab members included. */
export function panelsOf(node: Node): PanelRef[] {
  if (node.type === 'board') return [];
  if (node.type === 'panel') return [node.panel];
  if (node.type === 'tabs') return node.panels;
  return node.children.flatMap(panelsOf);
}

/** The panel a `refId` names, or `null` for an unknown id. */
export function refFromId(id: string): PanelRef | null {
  const [kind, rank] = id.split(':');
  if (!PANEL_KINDS.includes(kind as PanelKind)) return null;
  if (kind !== 'subboard') return { kind: kind as PanelKind };
  return { kind: 'subboard', rank: rank === '2' ? 2 : rank === '3' ? 3 : 1 };
}
