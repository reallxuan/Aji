import { useEffect } from 'react';
import { useEngineStoreApi } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import { getTrend } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { useTrendStore } from './trendStore';

/**
 * Keeps the trend store on the open game: fetched on mount and when the engine starts (a new
 * process may have a new cache), replaced by `gameTrend` events, and fed live by every analysis
 * update for the position on the board.
 *
 * A node that adds no move (a comment, a marker) has its parent's key, so consecutive snapshots
 * with one key form a group, and each update is recorded at every line index in it; an index
 * joining the group takes the analysis the engine already has.
 */
export function useTrendSync(): void {
  const transport = useTransport();
  const engine = useEngineStoreApi();

  useEffect(() => {
    let active = true;
    let group: { key: string; indexes: number[] } | null = null;
    const record = (lineIndex: number, analysis: AnalysisUpdate) =>
      useTrendStore.getState().record(lineIndex, {
        winrate: analysis.winrate,
        scoreLead: analysis.scoreLead,
        visits: analysis.rootVisits,
      });
    const join = (snapshot: GameSnapshot | null) => {
      if (snapshot?.positionKey == null) {
        // No position, or an illegal one: nothing is analysed there.
        group = null;
      } else if (group?.key !== snapshot.positionKey) {
        group = { key: snapshot.positionKey, indexes: [snapshot.lineIndex] };
      } else if (!group.indexes.includes(snapshot.lineIndex)) {
        group.indexes.push(snapshot.lineIndex);
        const { analysis } = engine.getState();
        if (analysis?.position === group.key) record(snapshot.lineIndex, analysis);
      }
    };
    join(useGameStore.getState().snapshot);
    const unsubscribeGame = useGameStore.subscribe((state, previous) => {
      if (active && state.snapshot !== previous.snapshot) join(state.snapshot);
    });
    // A pushed trend or a later fetch makes an earlier fetch's answer stale.
    let generation = 0;
    const fetch = () => {
      const mine = ++generation;
      getTrend(transport).then(
        (nodes) => {
          if (active && mine === generation) useTrendStore.getState().setNodes(nodes);
        },
        () => {
          // The graph keeps what it has; the next push or restart fetches again.
        },
      );
    };
    const unsubscribe = transport.subscribe((event) => {
      if (!active) return;
      if (event.type === 'gameTrend') {
        generation++;
        useTrendStore.getState().setNodes(event.nodes);
        // Another game, or the same one re-read: its line indexes are not the old ones.
        group = null;
        join(useGameStore.getState().snapshot);
      } else if (event.type === 'engineState' && event.engine.state === 'starting') {
        fetch();
      } else if (event.type === 'analysisUpdate') {
        const snapshot = useGameStore.getState().snapshot;
        const { analysis } = event;
        if (!snapshot || snapshot.positionKey !== analysis.position) return;
        if (group?.key !== analysis.position) join(snapshot);
        for (const lineIndex of group!.indexes) record(lineIndex, analysis);
      }
    });
    fetch();
    return () => {
      active = false;
      unsubscribe();
      unsubscribeGame();
    };
  }, [transport, engine]);
}
