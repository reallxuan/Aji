import { afterEach, expect, it } from 'vitest';
import type { TrendNode } from '../transport/generated/TrendNode';
import { resetTrendStore, useTrendStore } from './trendStore';

afterEach(() => resetTrendStore());

const node = (moveNumber: number): TrendNode => ({
  moveNumber,
  mover: moveNumber === 0 ? null : moveNumber % 2 ? 'black' : 'white',
  move: null,
  stats: null,
  loss: null,
});

it('record keeps the deeper stats', () => {
  const store = useTrendStore.getState();
  store.setNodes([node(0), node(1), node(2)]);
  store.record(1, { winrate: 0.4, scoreLead: -1, visits: 100 });
  store.record(1, { winrate: 0.6, scoreLead: 1, visits: 50 });
  expect(useTrendStore.getState().nodes[1].stats).toEqual({
    winrate: 0.4,
    scoreLead: -1,
    visits: 100,
  });
  store.record(1, { winrate: 0.45, scoreLead: -0.5, visits: 300 });
  expect(useTrendStore.getState().nodes[1].stats?.visits).toBe(300);
  expect(useTrendStore.getState().nodes[0].stats).toBeNull();
});

it('record ignores a bad index', () => {
  const store = useTrendStore.getState();
  store.setNodes([node(0), node(1)]);
  const before = useTrendStore.getState().nodes;
  store.record(2, { winrate: 0.4, scoreLead: -1, visits: 100 });
  store.record(-1, { winrate: 0.4, scoreLead: -1, visits: 100 });
  expect(useTrendStore.getState().nodes).toBe(before);
});

const stats = (winrate: number, visits: number) => ({ winrate, scoreLead: 0, visits });

it('trend nodes merge by line index', () => {
  const store = useTrendStore.getState();
  store.setNodes([node(0), node(1), node(2)], 4);
  store.record(1, stats(0.5, 900));
  store.applyNodes(4, [
    { lineIndex: 1, stats: stats(0.6, 500), loss: { winrate: 12, score: 3 } },
    { lineIndex: 2, stats: stats(0.4, 500), loss: null },
    { lineIndex: 7, stats: stats(0.4, 500), loss: null },
  ]);
  const nodes = useTrendStore.getState().nodes;
  // The deeper live stats stay; the loss comes from the backend.
  expect(nodes[1].stats).toEqual(stats(0.5, 900));
  expect(nodes[1].loss).toEqual({ winrate: 12, score: 3 });
  expect(nodes[2].stats).toEqual(stats(0.4, 500));
  expect(nodes).toHaveLength(3);
  // A node the backend has no result for keeps what it has.
  store.applyNodes(4, [{ lineIndex: 2, stats: null, loss: null }]);
  expect(useTrendStore.getState().nodes[2].stats).toEqual(stats(0.4, 500));
});

it('an older revision is ignored', () => {
  const store = useTrendStore.getState();
  store.setNodes([node(0), node(1)], 4);
  const before = useTrendStore.getState().nodes;
  store.applyNodes(3, [{ lineIndex: 1, stats: stats(0.6, 500), loss: null }]);
  // A newer one is for a line not sent yet.
  store.applyNodes(5, [{ lineIndex: 1, stats: stats(0.6, 500), loss: null }]);
  expect(useTrendStore.getState().nodes).toBe(before);
  expect(useTrendStore.getState().revision).toBe(4);
});
