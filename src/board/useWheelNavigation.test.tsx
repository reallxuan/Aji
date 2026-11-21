import { act, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetViewStore, useViewStore } from '../analysis/viewStore';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { useWheelNavigation } from './useWheelNavigation';

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
  resetViewStore();
});

function Board() {
  const ref = useRef<HTMLDivElement>(null);
  useWheelNavigation(ref);
  return <div ref={ref} data-testid="board" />;
}

const frame = async () =>
  act(async () => {
    vi.advanceTimersToNextFrame();
  });

const moves = (requests: { type: string }[]) =>
  requests.filter((r) => r.type === 'gameNavigate') as unknown as Array<{ to: unknown }>;

it('steps one move per 50 px of trackpad scrolling', async () => {
  const { requests, getByTestId } = renderWithGame(<Board />);
  for (let i = 0; i < 20; i++) {
    fireEvent.wheel(getByTestId('board'), { deltaY: 5, deltaMode: 0 });
    await frame();
  }
  expect(moves(requests).map((r) => r.to)).toEqual(['next', 'next']);
});

it('steps one move per notch of a mouse wheel, up for previous', async () => {
  const { requests, getByTestId } = renderWithGame(<Board />);
  fireEvent.wheel(getByTestId('board'), { deltaY: -3, deltaMode: 1 });
  await frame();
  expect(moves(requests).map((r) => r.to)).toEqual(['previous']);
});

it('moves at most once per frame during momentum', async () => {
  const { requests, getByTestId } = renderWithGame(<Board />);
  for (let i = 0; i < 6; i++) fireEvent.wheel(getByTestId('board'), { deltaY: 100, deltaMode: 0 });
  await frame();
  expect(moves(requests)).toHaveLength(1);
});

it('steps the variation while a candidate is hovered, and never navigates', async () => {
  const { requests, getByTestId } = renderWithGame(<Board />);
  act(() => {
    const view = useViewStore.getState();
    view.setHover({ move: { type: 'play', x: 3, y: 3 }, source: 'board' });
    view.setVariation({
      moves: [
        { type: 'play', x: 0, y: 0 },
        { type: 'play', x: 1, y: 0 },
        { type: 'play', x: 2, y: 0 },
      ],
      colors: ['black', 'white', 'black'],
      captured: [[], [], []],
      illegalAt: null,
    });
  });
  const wheel = async (deltaY: number) => {
    fireEvent.wheel(getByTestId('board'), { deltaY, deltaMode: 1 });
    await frame();
  };
  expect(useViewStore.getState().step).toBe(3);
  await wheel(3);
  expect(useViewStore.getState().step).toBe(3);
  await wheel(-3);
  expect(useViewStore.getState().step).toBe(2);
  for (let i = 0; i < 5; i++) await wheel(-3);
  expect(useViewStore.getState().step).toBe(1);
  await wheel(3);
  expect(useViewStore.getState().step).toBe(2);
  expect(moves(requests)).toEqual([]);
});

it('does not navigate while a candidate is hovered before its line arrives', async () => {
  const { requests, getByTestId } = renderWithGame(<Board />);
  act(() =>
    useViewStore.getState().setHover({ move: { type: 'play', x: 3, y: 3 }, source: 'table' }),
  );
  fireEvent.wheel(getByTestId('board'), { deltaY: 3, deltaMode: 1 });
  await frame();
  expect(moves(requests)).toEqual([]);
});

it('ignores the wheel with ctrl held, which is a pinch', async () => {
  const { requests, getByTestId } = renderWithGame(<Board />);
  fireEvent.wheel(getByTestId('board'), { deltaY: 3, deltaMode: 1, ctrlKey: true });
  await frame();
  expect(moves(requests)).toEqual([]);
});

it('navigates when no candidate is hovered', async () => {
  const { requests, getByTestId } = renderWithGame(<Board />);
  fireEvent.wheel(getByTestId('board'), { deltaY: 3, deltaMode: 1 });
  await frame();
  expect(moves(requests).map((r) => r.to)).toEqual(['next']);
});
