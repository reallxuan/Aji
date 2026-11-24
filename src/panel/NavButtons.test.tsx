import { connectReplay } from '../game/actions';
import { useReplayStore } from '../game/replayStore';
import { createI18n } from '../i18n/createI18n';
import type { Response } from '../transport/generated/Response';
import { BottomNav } from './BottomNav';
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
  makeSnapshot({ atStart, atEnd, hasMoves: true, moveNumber: 5, lineLength: 10 });

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

it.each(['上一手', '下一手'])(
  'a phone press on %s cannot step again after an in-flight replay lands',
  async (name) => {
    let deliver!: (r: Response) => void;
    const tick = new Promise<Response>((resolve) => {
      deliver = resolve;
    });
    const { transport, files, requests } = renderWithGame(<BottomNav />, {
      snapshot: at(false, false),
      answer: (r) => (r.type === 'gameNavigate' && r.to === 'next' ? tick : undefined),
    });
    const disconnect = connectReplay({ transport, files, t: createI18n('en').t });
    try {
      await act(async () => useReplayStore.getState().start());
      await act(async () => vi.advanceTimersByTimeAsync(1500));
      const button = screen.getByRole('button', { name });
      const touch = { pointerType: 'touch', pointerId: 12, button: 0, isPrimary: true };
      fireEvent.pointerDown(button, touch);
      const wasPlaying = useReplayStore.getState().playing;
      await act(async () =>
        deliver({
          type: 'game',
          warnings: [],
          snapshot: makeSnapshot({
            revision: 2,
            node: 9,
            lineIndex: 1,
            atStart: false,
            atEnd: false,
          }),
        }),
      );
      fireEvent.pointerUp(button, touch);
      fireEvent.click(button, { detail: 1 });
      await act(async () => vi.advanceTimersByTimeAsync(30));
      expect(requests.filter((r) => r.type === 'gameNavigate')).toEqual([
        { type: 'gameNavigate', to: 'next' },
      ]);
      expect(wasPlaying).toBe(false);
    } finally {
      act(disconnect);
    }
  },
);

it('phone navigation waits for a click, respects touch cancellation, and accepts keyboard activation', async () => {
  const { transport, files, requests } = renderWithGame(<BottomNav />, {
    snapshot: at(false, false),
  });
  const disconnect = connectReplay({ transport, files, t: createI18n('en').t });
  const button = screen.getByRole('button', { name: '上一手' });
  const touch = { pointerType: 'touch', pointerId: 12, button: 0, isPrimary: true };
  try {
    await act(async () => useReplayStore.getState().start());
    fireEvent.pointerDown(button, touch);
    fireEvent.pointerCancel(button, touch);
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    const moves = () => requests.filter((r) => r.type === 'gameNavigate');
    expect(moves()).toEqual([]);
    fireEvent.click(button, { detail: 0 });
    await act(async () => vi.advanceTimersByTimeAsync(30));
    expect(moves()).toEqual([{ type: 'gameNavigate', to: 'previous' }]);
    fireEvent.pointerDown(button, touch);
    fireEvent.pointerUp(button, touch);
    fireEvent.click(button, { detail: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(30));
    expect(moves()).toHaveLength(2);
  } finally {
    act(disconnect);
  }
});
