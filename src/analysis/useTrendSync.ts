import { useEffect } from 'react';
import { useGameStore } from '../game/gameStore';
import { getTrend } from '../transport/api';
import type { TrendNode } from '../transport/generated/TrendNode';
import { useTransport } from '../transport/TransportProvider';
import { useTrendStore } from './trendStore';

/** Follows the selected line and contributes live analysis at all slots with the current key. */
export function useTrendSync(): void {
  const transport = useTransport();
  useEffect(() => {
    let active = true;
    // A pushed trend or a later fetch makes an earlier fetch's answer stale.
    let generation = 0;
    const replace = (revision: number, nodes: TrendNode[]) => {
      const current = useGameStore.getState().snapshot?.lineRevision ?? -1;
      if (revision >= current) useTrendStore.getState().setNodes(nodes, revision);
    };
    const fetch = () => {
      const mine = ++generation;
      const before = useTrendStore.getState().nodes;
      getTrend(transport).then(
        ({ revision, nodes }) => {
          if (!active || mine !== generation) return;
          const current = useTrendStore.getState();
          // A delta or a live result can overtake a read of the same line. Keep those slots,
          // while still refreshing the other slots from the engine's cache.
          if (revision === current.lineRevision && before !== current.nodes) {
            nodes = nodes.map((node, i) =>
              current.nodes[i] !== before[i] ? current.nodes[i] : node,
            );
          }
          replace(revision, nodes);
        },
        () => {
          // The graph keeps what it has; the next push or restart fetches again.
        },
      );
    };
    const unsubscribe = transport.subscribe((event) => {
      if (!active) return;
      const trend = useTrendStore.getState();
      const snapshot = useGameStore.getState().snapshot;
      if (event.type === 'gameTrend') {
        if (event.revision < Math.max(snapshot?.lineRevision ?? -1, trend.lineRevision ?? -1))
          return;
        generation++;
        replace(event.revision, event.nodes);
      } else if (event.type === 'trendNodes') {
        if (!snapshot || event.revision >= snapshot.lineRevision)
          trend.applyNodes(event.revision, event.nodes);
      } else if (event.type === 'engineState' && event.engine.state === 'starting') {
        fetch();
      } else if (event.type === 'analysisUpdate') {
        const { analysis } = event;
        if (
          snapshot?.lineRevision !== trend.lineRevision ||
          snapshot?.positionKey !== analysis.position
        )
          return;
        trend.record(analysis.position, {
          winrate: analysis.winrate,
          scoreLead: analysis.scoreLead,
          visits: analysis.rootVisits,
        });
      }
    });
    fetch();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [transport]);
}
