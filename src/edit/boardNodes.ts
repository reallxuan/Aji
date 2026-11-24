import type { GameTree } from '../transport/generated/GameTree';

export interface BoardNode {
  number: number;
  tryout: boolean;
  tryoutNumber: number;
  mainLine: boolean;
  firstChild: boolean;
}

/** Index once per tree. Its preorder puts parents before children, including setup and pass nodes. */
export function boardNodes(tree: GameTree | null) {
  const nodes = new Map<number, BoardNode>();
  const parents = new Set<number>();
  for (const node of tree?.nodes ?? []) {
    const parent = node.parent === null ? undefined : nodes.get(node.parent);
    const firstChild = node.parent === null || !parents.has(node.parent);
    if (node.parent !== null) parents.add(node.parent);
    const count = node.mv === null ? 0 : 1;
    const tryout = !!(node.flags & 2);
    nodes.set(node.id, {
      number: (parent?.number ?? 0) + count,
      tryout,
      tryoutNumber: tryout ? (parent?.tryoutNumber ?? 0) + count : 0,
      firstChild,
      mainLine: firstChild && (parent?.mainLine ?? true),
    });
  }
  return nodes;
}
