import {
  type Hidden,
  type Layout,
  type Node,
  PANEL_KINDS,
  type PanelKind,
  type PanelRef,
  panelsOf,
  type PresetId,
  refId,
  type SplitNode,
} from './model';
import { normalise, PRESET_IDS, presetLayout } from './presets';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function readRef(raw: unknown): PanelRef | null {
  if (!isRecord(raw) || !PANEL_KINDS.includes(raw.kind as PanelKind)) return null;
  const ref: PanelRef = { kind: raw.kind as PanelKind };
  if (ref.kind === 'subboard') ref.rank = raw.rank === 2 || raw.rank === 3 ? raw.rank : 1;
  if (
    ref.kind === 'candidates' &&
    typeof raw.maxRows === 'number' &&
    Number.isInteger(raw.maxRows) &&
    raw.maxRows > 0
  ) {
    ref.maxRows = raw.maxRows;
  }
  return ref;
}

/**
 * Reads one node. `seen` holds the panels already placed, so a later copy is dropped; `atRoot`
 * says whether a board may stand here (only directly in the root row).
 */
function readNode(
  raw: unknown,
  seen: Set<string>,
  atRoot: boolean,
  board: { found: boolean },
): Node | null {
  if (!isRecord(raw)) return null;
  const take = (ref: PanelRef | null) => {
    if (!ref || seen.has(refId(ref))) return null;
    seen.add(refId(ref));
    return ref;
  };
  switch (raw.type) {
    case 'board':
      if (!atRoot || board.found) return null;
      board.found = true;
      return { type: 'board' };
    case 'panel': {
      const ref = take(readRef(raw.panel));
      return ref ? { type: 'panel', panel: ref } : null;
    }
    case 'tabs': {
      const panels = (Array.isArray(raw.panels) ? raw.panels : [])
        .map((r) => take(readRef(r)))
        .filter((r): r is PanelRef => r !== null);
      if (panels.length === 0) return null;
      if (panels.length === 1) return { type: 'panel', panel: panels[0] };
      const active =
        typeof raw.active === 'number' && Number.isInteger(raw.active) ? raw.active : 0;
      return { type: 'tabs', panels, active: Math.min(Math.max(active, 0), panels.length - 1) };
    }
    case 'split': {
      if (raw.dir !== 'row' && raw.dir !== 'column') return null;
      const rawChildren = Array.isArray(raw.children) ? raw.children : [];
      const rawWeights = Array.isArray(raw.weights) ? raw.weights : [];
      const kept: Array<{ node: Node; weight: unknown }> = [];
      rawChildren.forEach((child, i) => {
        const node = readNode(child, seen, false, board);
        if (node) kept.push({ node, weight: rawWeights[i] });
      });
      if (kept.length === 0) return null;
      if (kept.length === 1) return kept[0].node;
      const weights =
        rawWeights.length === rawChildren.length
          ? normalise(kept.map((k) => k.weight))
          : normalise(kept.map(() => 1));
      const split: SplitNode = {
        type: 'split',
        dir: raw.dir,
        children: kept.map((k) => k.node),
        weights,
      };
      if (typeof raw.cap === 'number' && Number.isFinite(raw.cap) && raw.cap > 0)
        split.cap = raw.cap;
      return split;
    }
    default:
      return null;
  }
}

function readRoot(raw: unknown, seen: Set<string>): SplitNode | null {
  if (!isRecord(raw) || raw.type !== 'split' || raw.dir !== 'row') return null;
  const board = { found: false };
  const rawChildren = Array.isArray(raw.children) ? raw.children : [];
  const rawWeights = Array.isArray(raw.weights) ? raw.weights : [];
  const kept: Array<{ node: Node; weight: unknown }> = [];
  rawChildren.forEach((child, i) => {
    const node = readNode(child, seen, true, board);
    if (node) kept.push({ node, weight: rawWeights[i] });
  });
  if (!board.found) return null;
  const weights =
    rawWeights.length === rawChildren.length
      ? normalise(kept.map((k) => k.weight))
      : normalise(kept.map(() => 1));
  return { type: 'split', dir: 'row', children: kept.map((k) => k.node), weights };
}

function readHidden(raw: unknown, shown: Set<string>): Hidden[] {
  if (!Array.isArray(raw)) return [];
  const out: Hidden[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const panel = readRef(entry.panel);
    if (!panel || panel.kind === 'header' || shown.has(refId(panel))) continue;
    shown.add(refId(panel));
    const besides = entry.besides === null ? null : readRef(entry.besides);
    out.push({ panel, besides, side: entry.side === 'before' ? 'before' : 'after' });
  }
  return out;
}

/**
 * Reads a stored layout (design 5.1). Unknown panels and second copies are dropped, empty groups
 * removed, single children lifted, weights normalised. Anything that leaves no board in the root
 * row, no header, or another version, reads as the default preset. Never throws.
 */
export function validateLayout(raw: unknown): Layout {
  const fallback = presetLayout('default');
  try {
    if (!isRecord(raw) || raw.version !== 1) return fallback;
    const seen = new Set<string>();
    const root = readRoot(raw.root, seen);
    if (!root || !panelsOf(root).some((p) => p.kind === 'header')) return fallback;
    const preset =
      typeof raw.preset === 'string' && (PRESET_IDS as readonly string[]).includes(raw.preset)
        ? (raw.preset as PresetId)
        : 'custom';
    return {
      version: 1,
      preset,
      root,
      hidden: readHidden(raw.hidden, seen),
      lines: raw.lines === 'subboard' ? 'subboard' : 'board',
    };
  } catch {
    return fallback;
  }
}
