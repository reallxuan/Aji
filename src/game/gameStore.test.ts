import { afterEach, expect, it } from 'vitest';
import { createEngineStore } from '../engine/engineStore';
import { resetGameStore, useGameStore } from './gameStore';
import { makeSnapshot } from './testing';

afterEach(() => resetGameStore());

it('ignores a snapshot that is not newer', () => {
  const { apply } = useGameStore.getState();
  apply(makeSnapshot({ revision: 5, moveNumber: 5 }));
  apply(makeSnapshot({ revision: 4, moveNumber: 4 }));
  apply(makeSnapshot({ revision: 5, moveNumber: 9 }));
  expect(useGameStore.getState().snapshot?.moveNumber).toBe(5);
  apply(makeSnapshot({ revision: 6, moveNumber: 6 }));
  expect(useGameStore.getState().snapshot?.moveNumber).toBe(6);
});

it('sets the engine store position, or clears it on an illegal node', () => {
  const engine = createEngineStore();
  const { apply, bindEngine } = useGameStore.getState();
  bindEngine(engine);
  apply(makeSnapshot({ revision: 1, positionKey: '00000000000000ab' }));
  expect(engine.getState().position).toBe('00000000000000ab');
  expect(engine.getState().positionOwned).toBe(true);
  apply(makeSnapshot({ revision: 2, positionKey: null, illegal: 'occupied' }));
  expect(engine.getState().position).toBeNull();
});

it('is loaded once the first snapshot arrives', () => {
  expect(useGameStore.getState().loaded).toBe(false);
  useGameStore.getState().apply(makeSnapshot());
  expect(useGameStore.getState().loaded).toBe(true);
});
