import { useEffect } from 'react';
import { getGameTree } from '../transport/api';
import type { GameTree } from '../transport/generated/GameTree';
import { useTransport } from '../transport/TransportProvider';
import { useGameStore } from './gameStore';
import { useTreeStore } from './treeStore';

function apply(tree: GameTree) {
  const snapshot = useGameStore.getState().snapshot;
  if (!snapshot || tree.revision >= snapshot.treeRevision) useTreeStore.getState().apply(tree);
}

/** An edit broadcasts the new tree. Fetch on mount or if the snapshot is ahead of the tree. */
export function useTreeSync() {
  const transport = useTransport();
  const revision = useGameStore((s) => s.snapshot?.treeRevision);
  useEffect(
    () =>
      transport.subscribe((event) => {
        if (event.type === 'gameTree') apply(event.tree);
      }),
    [transport],
  );
  useEffect(() => {
    if (revision === undefined || (useTreeStore.getState().tree?.revision ?? -1) >= revision)
      return;
    let active = true;
    getGameTree(transport).then(
      (tree) => {
        if (active) apply(tree);
      },
      () => {
        // A later revision or the service's push can still supply the tree.
      },
    );
    return () => {
      active = false;
    };
  }, [transport, revision]);
}
