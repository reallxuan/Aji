import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { candidate, KEY, play, subBoardHarness } from './subBoardTesting';
import { useSubBoardLine } from './useSubBoardLine';
import { resetViewStore, useViewStore } from './viewStore';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
  resetViewStore();
});

/** Lets the preview promises settle. */
const settle = () => act(async () => {});
const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
const line = (n: number) => Array.from({ length: n }, (_, i) => play(3 + i, 3 + (i % 2)));

function mount(rank: 1 | 2 | 3 = 1) {
  const h = subBoardHarness();
  const hook = renderHook(() => useSubBoardLine(rank), { wrapper: h.wrapper });
  return { ...h, hook };
}

it('follows the deepening line at most twice a second', async () => {
  const { analyse, previews, hook } = mount();
  analyse([candidate(0, 0.55, line(2))]);
  await settle();
  expect(hook.result.current.line?.moves).toHaveLength(2);
  expect(previews()).toHaveLength(1);
  for (let n = 3; n <= 7; n++) {
    await advance(80);
    analyse([candidate(0, 0.55, line(n))]);
    await settle();
  }
  // Five updates in 400 ms: no refresh yet.
  expect(previews()).toHaveLength(1);
  await advance(200);
  await settle();
  expect(previews()).toHaveLength(2);
  expect(hook.result.current.line?.moves).toHaveLength(7);
  expect(hook.result.current.step).toBe(7);
});

it('stepping freezes until the position changes', async () => {
  const { analyse, previews, hook } = mount();
  analyse([candidate(0, 0.55, line(4))]);
  await settle();
  act(() => hook.result.current.setStep(2));
  expect(hook.result.current).toMatchObject({ step: 2, frozen: true });
  analyse([candidate(0, 0.55, line(6))]);
  await advance(1000);
  await settle();
  expect(previews()).toHaveLength(1);
  expect(hook.result.current.line?.moves).toHaveLength(4);
  // A new position restarts the line.
  act(() =>
    useGameStore.getState().apply(makeSnapshot({ revision: 2, positionKey: 'cdcdcdcdcdcdcdcd' })),
  );
  analyse([candidate(0, 0.55, line(5))], 'cdcdcdcdcdcdcdcd');
  await settle();
  expect(previews()).toHaveLength(2);
  expect(hook.result.current).toMatchObject({ step: 5, frozen: false });
});

it('a new first move restarts', async () => {
  const { analyse, previews, hook } = mount();
  analyse([candidate(0, 0.55, line(4))]);
  await settle();
  act(() => hook.result.current.setStep(1));
  analyse([candidate(0, 0.56, [play(15, 15), play(16, 16)])]);
  await settle();
  expect(previews()).toHaveLength(2);
  expect(hook.result.current.line?.moves[0]).toEqual(play(15, 15));
  expect(hook.result.current.frozen).toBe(false);
});

it('hidden candidates hide the line', async () => {
  const { analyse, hook } = mount();
  analyse([candidate(0, 0.55, line(3))]);
  await settle();
  act(() => useViewStore.getState().toggleHidden());
  expect(hook.result.current.line).toBeNull();
  act(() => useViewStore.getState().setHeld(true));
  act(() => useViewStore.getState().toggleHidden());
  expect(hook.result.current.line).toBeNull();
  act(() => useViewStore.getState().setHeld(false));
  expect(hook.result.current.line?.moves).toHaveLength(3);
});

it('ranks follow their own candidate, and a missing one has no line', async () => {
  const { analyse, hook } = mount(2);
  analyse([candidate(0, 0.55, line(3)), candidate(1, 0.52, [play(16, 3), play(16, 4)])]);
  await settle();
  expect(hook.result.current.line?.moves[0]).toEqual(play(16, 3));
  analyse([candidate(0, 0.55, line(3))], KEY);
  await settle();
  expect(hook.result.current.line).toBeNull();
});
