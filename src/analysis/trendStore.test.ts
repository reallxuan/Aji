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
