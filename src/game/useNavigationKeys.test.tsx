import { act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetGameStore, useGameStore } from './gameStore';
import { makeSnapshot } from './testing';
import { renderWithGame } from './renderWithGame';
import { useNavigationKeys } from './useNavigationKeys';

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
});

function Keys() {
  useNavigationKeys();
  return <input aria-label="field" />;
}

const frame = async () =>
  act(async () => {
    vi.advanceTimersToNextFrame();
  });

it('steps with the arrows and jumps with Home and End', async () => {
  const { requests } = renderWithGame(<Keys />, { os: 'windows' });
  for (const [key, to] of [
    ['ArrowLeft', 'previous'],
    ['ArrowUp', 'previous'],
    ['ArrowRight', 'next'],
    ['ArrowDown', 'next'],
    ['Home', 'first'],
    ['End', 'last'],
  ]) {
    fireEvent.keyDown(window, { key });
    await frame();
    expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to });
  }
});

it('ignores keys typed into a field', async () => {
  const { requests, getByRole } = renderWithGame(<Keys />);
  fireEvent.keyDown(getByRole('textbox'), { key: 'ArrowRight' });
  await frame();
  expect(requests.filter((r) => r.type === 'gameNavigate')).toEqual([]);
});

it('sends one request for a frame of key repeats', async () => {
  const { requests } = renderWithGame(<Keys />);
  for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { key: 'ArrowRight', repeat: i > 0 });
  await frame();
  expect(requests.filter((r) => r.type === 'gameNavigate')).toHaveLength(1);
});

it('opens with Ctrl+O off macOS, and leaves ⌘O to the macOS menu', async () => {
  const windows = renderWithGame(<Keys />, { os: 'windows', files: { pick: null } });
  await act(async () => {});
  const picked = vi.spyOn(windows.files, 'pickOpen');
  fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
  await act(async () => {});
  expect(picked).toHaveBeenCalledTimes(1);
  windows.unmount();
  const mac = renderWithGame(<Keys />, { os: 'macos', files: { pick: null } });
  await act(async () => {});
  const macPicked = vi.spyOn(mac.files, 'pickOpen');
  fireEvent.keyDown(window, { key: 'o', metaKey: true });
  await act(async () => {});
  expect(macPicked).not.toHaveBeenCalled();
});

it('moves ten with PageDown, clamped to the end of the line', async () => {
  const { requests } = renderWithGame(<Keys />, {
    snapshot: makeSnapshot({ moveNumber: 30, mainLineLength: 45 }),
  });
  fireEvent.keyDown(window, { key: 'PageDown' });
  await frame();
  expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to: { move: 40 } });
  act(() =>
    useGameStore
      .getState()
      .apply(makeSnapshot({ revision: 500, moveNumber: 40, mainLineLength: 45 })),
  );
  fireEvent.keyDown(window, { key: 'PageDown' });
  await frame();
  expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to: { move: 45 } });
});

it('moves ten back with PageUp, stopping at the start', async () => {
  const { requests } = renderWithGame(<Keys />, {
    snapshot: makeSnapshot({ moveNumber: 4, mainLineLength: 45 }),
  });
  fireEvent.keyDown(window, { key: 'PageUp' });
  await frame();
  expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to: { move: 0 } });
});
