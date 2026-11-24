import {
  type Hidden,
  type Layout,
  type Node,
  type PanelRef,
  panelsOf,
  sameRef,
  type SplitNode,
} from './model';
import { validateLayout } from './validate';

/** Where a dragged panel lands (design 5.3). `null` drops nowhere. */
export type Drop =
  | { kind: 'split'; target: PanelRef; side: 'left' | 'right' | 'top' | 'bottom' }
  | { kind: 'tab'; target: PanelRef }
  | { kind: 'column'; side: 'left' | 'right' }
  | null;

const panelNode = (panel: PanelRef): Node => ({ type: 'panel', panel });
const holds = (node: Node, ref: PanelRef) => panelsOf(node).some((p) => sameRef(p, ref));
const mean = (ws: number[]) => (ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : 1);

/** A rearranged layout: custom from now on, and read back through validation. */
const finish = (layout: Layout, root: SplitNode, hidden = layout.hidden): Layout =>
  validateLayout({ ...layout, preset: 'custom', root, hidden });

/** The split directly holding the panel or tab group that shows `ref`, and its index there. */
function locate(
  split: SplitNode,
  ref: PanelRef,
): { parent: SplitNode; index: number; node: Node } | null {
  for (let i = 0; i < split.children.length; i++) {
    const child = split.children[i];
    if (child.type === 'split') {
      const found = locate(child, ref);
      if (found) return found;
    } else if (holds(child, ref)) {
      return { parent: split, index: i, node: child };
    }
  }
  return null;
}

/** The tree without `ref`. Groups it empties are dropped with their weights. */
function without(node: Node, ref: PanelRef): Node | null {
  switch (node.type) {
    case 'board':
      return node;
    case 'panel':
      return sameRef(node.panel, ref) ? null : node;
    case 'tabs': {
      const i = node.panels.findIndex((p) => sameRef(p, ref));
      if (i < 0) return node;
      const panels = node.panels.filter((_, j) => j !== i);
      if (panels.length === 1) return panelNode(panels[0]);
      const active = node.active > i ? node.active - 1 : Math.min(node.active, panels.length - 1);
      return { ...node, panels, active };
    }
    case 'split': {
      const kept = node.children
        .map((child, i) => ({ node: without(child, ref), weight: node.weights[i] }))
        .filter((k): k is { node: Node; weight: number } => k.node !== null);
      if (kept.length === 0) return null;
      return {
        ...node,
        children: kept.map((k) => k.node),
        weights: kept.map((k) => k.weight),
      };
    }
  }
}

const removed = (root: SplitNode, ref: PanelRef) => without(root, ref) as SplitNode;

/** Inserts `node` into `parent` at `index`, taking `weight`; mutates the cloned tree. */
function insertAt(parent: SplitNode, index: number, node: Node, weight: number) {
  parent.children.splice(index, 0, node);
  parent.weights.splice(index, 0, weight);
}

/** Moves a panel to where it was dropped (design 5.3). */
export function movePanel(layout: Layout, ref: PanelRef, drop: Drop): Layout {
  if (!drop) return layout;
  if (drop.kind !== 'column' && sameRef(drop.target, ref)) return layout;
  const root = structuredClone(removed(layout.root, ref));
  const moving = panelNode(ref);

  if (drop.kind === 'column') {
    const board = root.children.findIndex((c) => c.type === 'board');
    insertAt(root, drop.side === 'left' ? board : board + 1, moving, mean(root.weights));
    return finish(layout, root);
  }

  // The header never shares a tab group: such a drop goes below the target instead.
  const asTab = drop.kind === 'tab' && drop.target.kind !== 'header' && ref.kind !== 'header';
  const place = locate(root, drop.target);
  if (!place) return layout;
  const { parent, index, node } = place;

  if (asTab) {
    parent.children[index] =
      node.type === 'tabs'
        ? { ...node, panels: [...node.panels, ref], active: node.panels.length }
        : { type: 'tabs', panels: [...panelsOf(node), ref], active: 1 };
    return finish(layout, root);
  }

  const side = drop.kind === 'split' ? drop.side : 'bottom';
  const dir = side === 'left' || side === 'right' ? 'row' : 'column';
  const before = side === 'left' || side === 'top';
  if (parent.dir === dir) {
    const half = parent.weights[index] / 2;
    parent.weights[index] = half;
    insertAt(parent, before ? index : index + 1, moving, half);
  } else {
    parent.children[index] = {
      type: 'split',
      dir,
      children: before ? [moving, node] : [node, moving],
      weights: [0.5, 0.5],
    };
  }
  return finish(layout, root);
}

/** The split at `path` (child indices from the root), in a cloned tree. */
function splitAt(root: SplitNode, path: number[]): SplitNode | null {
  let node: Node = root;
  for (const i of path) {
    if (node.type !== 'split' || !node.children[i]) return null;
    node = node.children[i];
  }
  return node.type === 'split' ? node : null;
}

/**
 * Moves the hairline between two visible children of the split at `path` by `delta` px. `sizes` are the two
 * neighbours' sizes as measured when the drag began, `mins` their minimum sizes; neither goes
 * below its minimum. Starting from the measured sizes keeps the line under the pointer even where
 * a minimum had already bent the weights.
 */
export function resize(
  layout: Layout,
  path: number[],
  firstIndex: number,
  delta: number,
  sizes: [number, number],
  mins: [number, number],
  secondIndex = firstIndex + 1,
): Layout {
  const root = structuredClone(layout.root);
  const split = splitAt(root, path);
  const total = sizes[0] + sizes[1];
  if (!split || secondIndex >= split.children.length || total <= 0) return layout;
  const pair = split.weights[firstIndex] + split.weights[secondIndex];
  const first = sizes[0] + delta;
  const lo = Math.min(mins[0], total);
  const hi = Math.max(lo, total - mins[1]);
  const clamped = Math.min(Math.max(first, lo), hi);
  split.weights[firstIndex] = (pair * clamped) / total;
  split.weights[secondIndex] = pair - split.weights[firstIndex];
  return finish(layout, root);
}

/** Gives the two visible neighbours of the hairline the same weight. */
export function evenSplit(
  layout: Layout,
  path: number[],
  firstIndex: number,
  secondIndex = firstIndex + 1,
): Layout {
  const root = structuredClone(layout.root);
  const split = splitAt(root, path);
  if (!split || secondIndex >= split.children.length) return layout;
  const half = (split.weights[firstIndex] + split.weights[secondIndex]) / 2;
  split.weights[firstIndex] = half;
  split.weights[secondIndex] = half;
  return finish(layout, root);
}

/** The neighbour a hidden panel goes back beside, and on which side. */
function neighbour(root: SplitNode, ref: PanelRef): Pick<Hidden, 'besides' | 'side'> {
  const place = locate(root, ref);
  if (!place) return { besides: null, side: 'after' };
  const { parent, index, node } = place;
  if (node.type === 'tabs') {
    const i = node.panels.findIndex((p) => sameRef(p, ref));
    return i > 0
      ? { besides: node.panels[i - 1], side: 'after' }
      : { besides: node.panels[1], side: 'before' };
  }
  const prev = parent.children[index - 1];
  if (prev && prev.type !== 'board')
    return { besides: panelsOf(prev).at(-1) ?? null, side: 'after' };
  const next = parent.children[index + 1];
  if (next && next.type !== 'board') return { besides: panelsOf(next)[0] ?? null, side: 'before' };
  return { besides: null, side: 'after' };
}

/** Hides a shown panel, remembering its neighbour (design 5.3). The header cannot be hidden. */
export function hidePanel(layout: Layout, ref: PanelRef): Layout {
  if (ref.kind === 'header' || !holds(layout.root, ref)) return layout;
  const entry: Hidden = { panel: ref, ...neighbour(layout.root, ref) };
  const hidden = [...layout.hidden.filter((h) => !sameRef(h.panel, ref)), entry];
  return finish(layout, removed(layout.root, ref), hidden);
}

/** Shows a panel again beside its remembered neighbour, or at the end of the header's column. */
export function showPanel(layout: Layout, ref: PanelRef): Layout {
  if (holds(layout.root, ref)) return layout;
  const entry = layout.hidden.find((h) => sameRef(h.panel, ref));
  const panel = entry?.panel ?? ref;
  const hidden = layout.hidden.filter((h) => !sameRef(h.panel, ref));
  const root = structuredClone(layout.root);

  const place = entry?.besides ? locate(root, entry.besides) : null;
  if (entry && place) {
    const { parent, index, node } = place;
    if (node.type === 'tabs') {
      const i = node.panels.findIndex((p) => entry.besides && sameRef(p, entry.besides));
      const panels = [...node.panels];
      panels.splice(entry.side === 'before' ? i : i + 1, 0, panel);
      parent.children[index] = { ...node, panels };
    } else {
      insertAt(
        parent,
        entry.side === 'before' ? index : index + 1,
        panelNode(panel),
        mean(parent.weights),
      );
    }
    return finish(layout, root, hidden);
  }

  const column = root.children.findIndex((c) => holds(c, { kind: 'header' }));
  const holder = root.children[column];
  if (holder.type === 'split' && holder.dir === 'column') {
    insertAt(holder, holder.children.length, panelNode(panel), mean(holder.weights));
  } else {
    root.children[column] = {
      type: 'split',
      dir: 'column',
      children: [holder, panelNode(panel)],
      weights: [0.5, 0.5],
    };
  }
  return finish(layout, root, hidden);
}

/** A tab group's active panel becomes `ref`. Not a rearrangement: the preset is kept. */
export function selectTab(layout: Layout, ref: PanelRef): Layout {
  const visit = (node: Node): Node => {
    if (node.type === 'tabs') {
      const i = node.panels.findIndex((p) => sameRef(p, ref));
      return i < 0 ? node : { ...node, active: i };
    }
    if (node.type === 'split') return { ...node, children: node.children.map(visit) };
    return node;
  };
  const next = { ...layout, root: visit(layout.root) as SplitNode };
  if (layout.preset === 'default') {
    const wideTabs = layout.wideTabs ?? { analysis: 'candidates', record: 'tree' };
    if (ref.kind === 'swings' || ref.kind === 'candidates')
      next.wideTabs = { ...wideTabs, analysis: ref.kind };
    if (ref.kind === 'tree' || ref.kind === 'comments')
      next.wideTabs = { ...wideTabs, record: ref.kind };
  }
  return next;
}
