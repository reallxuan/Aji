import type { GameTree } from '../transport/generated/GameTree';

export function record(parents: (number | null)[]): GameTree {
  return {
    revision: 0,
    nodes: parents.map((parent, id) => ({
      id,
      parent,
      color: parent === null ? null : 'black',
      mv: parent === null ? null : { type: 'pass' },
      flags: parent === null ? 4 : 0,
    })),
  };
}
