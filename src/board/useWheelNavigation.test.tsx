import { act, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { useWheelNavigation } from './useWheelNavigation';

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
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
