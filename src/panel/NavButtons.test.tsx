import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { NavButtons } from './NavButtons';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
});

const at = (atStart: boolean, atEnd: boolean) =>
  makeSnapshot({ atStart, atEnd, hasMoves: true, moveNumber: 5, mainLineLength: 10 });

it('disables first and previous at the start, next and last at the end', () => {
  const { unmount } = renderWithGame(<NavButtons />, { snapshot: at(true, false) });
  expect(screen.getByRole('button', { name: '第一手' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '上一手' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下一手' })).toBeEnabled();
  unmount();
  resetGameStore();
  renderWithGame(<NavButtons />, { snapshot: at(false, true) });
  expect(screen.getByRole('button', { name: '下一手' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '最后一手' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '第一手' })).toBeEnabled();
});

it('repeats while held: once, then after 400 ms every 60 ms', async () => {
  const { requests } = renderWithGame(<NavButtons />, { snapshot: at(false, false) });
  const next = screen.getByRole('button', { name: '下一手' });
  await act(async () => {
    fireEvent.pointerDown(next, { button: 0 });
  });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  fireEvent.pointerUp(next);
  // A step goes out on the next frame, as the keys' do (P2 M1 Task 5): the last held one too.
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  const sent = requests.filter((r) => r.type === 'gameNavigate');
  expect(sent.length).toBeGreaterThanOrEqual(9);
  expect(sent.length).toBeLessThanOrEqual(12);
  expect(sent[0]).toEqual({ type: 'gameNavigate', to: 'next' });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(requests.filter((r) => r.type === 'gameNavigate')).toHaveLength(sent.length);
});

it('runs once from the keyboard', async () => {
  const { requests } = renderWithGame(<NavButtons />, { snapshot: at(false, false) });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '第一手' }), { detail: 0 });
    vi.advanceTimersToNextFrame();
  });
  expect(requests.filter((r) => r.type === 'gameNavigate')).toEqual([
    { type: 'gameNavigate', to: 'first' },
  ]);
});
