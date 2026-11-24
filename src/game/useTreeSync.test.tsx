import { act } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from './gameStore';
import { renderWithGame } from './renderWithGame';
import { makeSnapshot } from './testing';
import { useTreeStore } from './treeStore';
import { useGameSync } from './useGameSync';

afterEach(() => {
  resetGameStore();
  useTreeStore.setState({ tree: null });
});

it('fetches on a newer treeRevision only and rejects superseded results', async () => {
  function Game() {
    useGameSync();
    return null;
  }
  const { requests, transport } = renderWithGame(<Game />, {
    snapshot: makeSnapshot({ treeRevision: 1 }),
    answer: (request) => {
      if (request.type === 'gameTree') return { type: 'gameTree', revision: 1, nodes: [] };
    },
  });
  await act(async () => {});
  const count = () => requests.filter((r) => r.type === 'gameTree').length;
  expect(count()).toBe(1);
  expect(useTreeStore.getState().tree).toEqual({ revision: 1, nodes: [] });
  await act(async () =>
    transport.emit({
      type: 'gameSnapshot',
      snapshot: makeSnapshot({ revision: 200, treeRevision: 1 }),
    }),
  );
  expect(count()).toBe(1);
  await act(async () => {
    transport.emit({
      type: 'gameSnapshot',
      snapshot: makeSnapshot({ revision: 201, treeRevision: 3 }),
    });
    transport.emit({ type: 'gameTree', tree: { revision: 4, nodes: [] } });
    transport.emit({ type: 'gameTree', tree: { revision: 2, nodes: [] } });
  });
  expect(useTreeStore.getState().tree?.revision).toBe(4);
  await act(async () =>
    transport.emit({
      type: 'gameSnapshot',
      snapshot: makeSnapshot({ revision: 202, treeRevision: 5 }),
    }),
  );
  expect(count()).toBeGreaterThan(1);
  expect(useTreeStore.getState().tree?.revision).toBe(4);
});
