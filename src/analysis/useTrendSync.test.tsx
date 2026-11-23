import { act, render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it } from 'vitest';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { useEngineSync } from '../engine/useEngineSync';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { useGameSync } from '../game/useGameSync';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { PlatformProvider } from '../platform/PlatformProvider';
import { createFakeTransport } from '../transport/fake';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import type { TrendNode } from '../transport/generated/TrendNode';
import type { TrendStats } from '../transport/generated/TrendStats';
import { TransportProvider } from '../transport/TransportProvider';
import { resetTrendStore, useTrendStore } from './trendStore';
import { useTrendSync } from './useTrendSync';

afterEach(() => {
  resetGameStore();
  resetTrendStore();
});

const key = (i: number) => (0x1000 + i).toString(16).padStart(16, '0');

const line = (length: number, stats: (i: number) => TrendStats | null = () => null) =>
  Array.from({ length }, (_, i): TrendNode => ({
    moveNumber: i,
    mover: i === 0 ? null : i % 2 ? 'black' : 'white',
    move: null,
    stats: stats(i),
    loss: null,
  }));

/** A distinct win rate per line index, so a record at the wrong index shows. */
const statsOf = (i: number, visits = 100): TrendStats => ({
  winrate: i / 1000,
  scoreLead: i,
  visits,
});

const update = (i: number, visits = 100): AnalysisUpdate => ({
  position: key(i),
  boardSize: 19,
  rootVisits: visits,
  winrate: i / 1000,
  scoreLead: i,
  isFinal: false,
  candidates: [],
  previousVisits: 0,
  ownership: null,
  next: null,
});

function mount(trend: () => TrendNode[]) {
  const requests: Request[] = [];
  const transport = createFakeTransport((request): Response => {
    requests.push(request);
    if (request.type === 'gameTrend') return { type: 'trend', revision: 0, nodes: trend() };
    if (request.type === 'gameSnapshot')
      return { type: 'game', snapshot: makeSnapshot({ revision: 0 }), warnings: [] };
    return {
      type: 'engineStatus',
      engine: { state: 'analysing', version: '1' },
      position: null,
      analysis: null,
      rejected: null,
      running: null,
    };
  });
  const engine = createEngineStore();
  function Probe() {
    useEngineSync();
    useGameSync();
    useTrendSync();
    return null;
  }
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={engine}>
          <PlatformProvider files={createFakeFiles()}>
            <Probe />
          </PlatformProvider>
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>,
  );
  const trendRequests = () => requests.filter((r) => r.type === 'gameTrend').length;
  return { transport, engine, trendRequests };
}

const snapshotAt = (i: number, revision = i + 1) =>
  makeSnapshot({ revision, positionKey: key(i), lineIndex: i, moveNumber: i });

it('fetches on mount and replaces on event', async () => {
  const { transport, trendRequests } = mount(() => line(3, (i) => (i === 1 ? statsOf(1) : null)));
  await act(async () => {});
  expect(trendRequests()).toBe(1);
  expect(useTrendStore.getState().nodes).toHaveLength(3);
  expect(useTrendStore.getState().nodes[1].stats).toEqual(statsOf(1));
  act(() => transport.emit({ type: 'gameTrend', revision: 1, nodes: line(5) }));
  expect(useTrendStore.getState().nodes).toHaveLength(5);
  expect(useTrendStore.getState().nodes[1].stats).toBeNull();
});

it('refetches when the engine starts, and a restart keeps the points', async () => {
  const { transport, trendRequests } = mount(() => line(3, statsOf));
  await act(async () => {});
  await act(async () => transport.emit({ type: 'engineState', engine: { state: 'starting' } }));
  expect(trendRequests()).toBe(2);
  expect(useTrendStore.getState().nodes.map((n) => n.stats)).toEqual(
    [0, 1, 2].map((i) => statsOf(i)),
  );
  await act(async () =>
    transport.emit({ type: 'engineState', engine: { state: 'analysing', version: '1' } }),
  );
  expect(trendRequests()).toBe(2);
});

it('records only updates for the current key', async () => {
  const { transport } = mount(() => line(4));
  await act(async () => {});
  act(() => transport.emit({ type: 'gameSnapshot', snapshot: snapshotAt(2) }));
  act(() => transport.emit({ type: 'analysisUpdate', analysis: update(1) }));
  expect(useTrendStore.getState().nodes.every((n) => n.stats === null)).toBe(true);
  act(() => transport.emit({ type: 'analysisUpdate', analysis: update(2, 80) }));
  expect(useTrendStore.getState().nodes[2].stats).toEqual(statsOf(2, 80));
});

it('a held arrow never shows another position’s analysis', async () => {
  const { transport, engine } = mount(() => line(121));
  await act(async () => {});
  const check = () => {
    const snapshot = useGameStore.getState().snapshot!;
    const analysis = engine.getState().analysis;
    expect(analysis === null || analysis.position === snapshot.positionKey).toBe(true);
    useTrendStore.getState().nodes.forEach((node, i) => {
      if (node.stats) expect(node.stats).toEqual(statsOf(i, node.stats.visits));
    });
  };
  // Two seconds of a held arrow at 60 snapshots a second; the engine answers late, so most
  // updates are for positions already left behind.
  for (let i = 1; i <= 120; i++) {
    act(() => transport.emit({ type: 'gameSnapshot', snapshot: snapshotAt(i) }));
    check();
    for (const behind of [3, 1, 0]) {
      if (i - behind < 0) continue;
      act(() => transport.emit({ type: 'analysisUpdate', analysis: update(i - behind, 60 + i) }));
      check();
    }
  }
  expect(useTrendStore.getState().nodes[120].stats).toEqual(statsOf(120, 180));
});

it('a comment-only node shares its parent’s analysis, cached and live', async () => {
  const { transport } = mount(() => line(6));
  await act(async () => {});
  const nodes = () => useTrendStore.getState().nodes;
  act(() => transport.emit({ type: 'gameSnapshot', snapshot: snapshotAt(3) }));
  act(() => transport.emit({ type: 'analysisUpdate', analysis: update(3, 200) }));
  // Line index 4 is a comment on move 3: the same position, so the same key and no new query.
  const comment = makeSnapshot({ revision: 10, positionKey: key(3), lineIndex: 4, moveNumber: 3 });
  act(() => transport.emit({ type: 'gameSnapshot', snapshot: comment }));
  expect(nodes()[4].stats).toEqual(statsOf(3, 200));
  act(() => transport.emit({ type: 'analysisUpdate', analysis: update(3, 300) }));
  expect(nodes()[3].stats).toEqual(statsOf(3, 300));
  expect(nodes()[4].stats).toEqual(statsOf(3, 300));
});

it('a new game starts the shared-key group afresh', async () => {
  const { transport } = mount(() => line(6));
  await act(async () => {});
  act(() => transport.emit({ type: 'gameSnapshot', snapshot: snapshotAt(5) }));
  // The new game reaches the same position at another index. As the backend does, its snapshot
  // comes first and its trend after.
  const elsewhere = makeSnapshot({
    revision: 10,
    positionKey: key(5),
    lineIndex: 2,
    moveNumber: 2,
  });
  act(() => transport.emit({ type: 'gameSnapshot', snapshot: elsewhere }));
  act(() => transport.emit({ type: 'gameTrend', revision: 2, nodes: line(6) }));
  act(() => transport.emit({ type: 'analysisUpdate', analysis: update(5, 200) }));
  expect(useTrendStore.getState().nodes[2].stats).toEqual(statsOf(5, 200));
  expect(useTrendStore.getState().nodes[5].stats).toBeNull();
});
