import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candidate, play, subBoardHarness } from '../analysis/subBoardTesting';
import { resetViewStore, useViewStore } from '../analysis/viewStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { MainBoard } from '../layout/MainBoard';
import { boardGeometry } from './geometry';

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame'] }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
  resetViewStore();
});

const SIZE = 400;
const g = boardGeometry(SIZE, 19);
const settle = () => act(async () => {});
const frame = () =>
  act(async () => {
    vi.advanceTimersToNextFrame();
  });
const LINE = Array.from({ length: 8 }, (_, i) => play(3 + i, 3 + (i % 2)));
const OTHER = [play(15, 15), play(16, 15)];
const at = (x: number, y: number) => ({ clientX: g.lines[x], clientY: g.lines[y] });

async function mount() {
  const h = subBoardHarness();
  render(
    <h.wrapper>
      <MainBoard rect={{ x: 0, y: 0, width: SIZE, height: SIZE }} />
    </h.wrapper>,
  );
  h.analyse([candidate(0, 0.55, LINE), candidate(1, 0.5, OTHER)]);
  await settle();
  return h;
}

/** The board's surface, where the pointer handlers sit. */
const surface = () => document.querySelector('[data-board] > div') as HTMLElement;

function touch(points: Array<{ clientX: number; clientY: number }>, pointerId = 1) {
  const [first, ...rest] = points;
  const base = { pointerId, pointerType: 'touch', isPrimary: true, button: 0 };
  fireEvent.pointerDown(surface(), { ...base, ...first });
  for (const point of rest) fireEvent.pointerMove(surface(), { ...base, ...point });
  fireEvent.pointerUp(surface(), { ...base, ...(rest.at(-1) ?? first) });
}
const tap = (x: number, y: number) => touch([at(x, y)]);
/** A horizontal swipe of `dx` px through the board's middle, in 10 px moves. */
function swipe(dx: number) {
  const y = SIZE / 2;
  const start = SIZE / 2;
  const points = [{ clientX: start, clientY: y }];
  for (let moved = 10; moved <= Math.abs(dx); moved += 10)
    points.push({ clientX: start + Math.sign(dx) * moved, clientY: y });
  touch(points);
}
const view = () => useViewStore.getState();

describe('touch on the main board', () => {
  it('tap_a_candidate_pins_its_line', async () => {
    await mount();
    tap(3, 3);
    await settle();
    expect(view().hover).toMatchObject({ move: play(3, 3), pinned: true });
    expect(view().variation).not.toBeNull();
    // The mouse events a browser sends after a tap do not end it.
    fireEvent.mouseLeave(surface());
    expect(view().hover).not.toBeNull();
  });

  it('tap_empty_clears_it', async () => {
    await mount();
    tap(3, 3);
    await settle();
    expect(view().hover).not.toBeNull();
    tap(9, 9);
    expect(view().hover).toBeNull();
  });

  it('navigation_clears_a_pinned_line', async () => {
    await mount();
    tap(3, 3);
    await settle();
    expect(view().hover).not.toBeNull();
    act(() =>
      useGameStore.getState().apply(makeSnapshot({ revision: 2, positionKey: 'cdcdcdcdcdcdcdcd' })),
    );
    expect(view().hover).toBeNull();
  });

  it('swipe_120px_left_steps_three', async () => {
    await mount();
    tap(3, 3);
    await settle();
    act(() => view().setStep(2));
    swipe(-120);
    expect(view().step).toBe(5);
    swipe(80);
    expect(view().step).toBe(3);
    // A swipe is not a tap: the line stays.
    expect(view().hover).not.toBeNull();
  });

  it('swipe_without_a_line_navigates_the_game', async () => {
    const { requests } = await mount();
    swipe(-40);
    await frame();
    swipe(45);
    await frame();
    expect(requests.filter((r) => r.type === 'gameNavigate')).toEqual([
      { type: 'gameNavigate', to: 'next' },
      { type: 'gameNavigate', to: 'previous' },
    ]);
  });

  it('a vertical drag is neither a tap nor a swipe', async () => {
    const { requests } = await mount();
    touch([at(3, 3), at(3, 6), at(3, 9)]);
    await frame();
    expect(view().hover).toBeNull();
    expect(requests.filter((r) => r.type === 'gameNavigate')).toEqual([]);
  });

  it('mouse_hover_is_unchanged', async () => {
    await mount();
    fireEvent.mouseMove(surface(), at(3, 3));
    expect(view().hover).toEqual({ move: play(3, 3), source: 'board' });
    fireEvent.mouseLeave(surface());
    expect(view().hover).toBeNull();
  });

  it('a_second_tap_on_the_same_candidate_does_nothing_yet', async () => {
    await mount();
    tap(3, 3);
    await settle();
    const before = view().hover;
    tap(3, 3);
    expect(view().hover).toBe(before);
    expect(view().variation).not.toBeNull();
  });

  it('a long press does nothing yet', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'Date', 'performance'] });
    await mount();
    const base = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 };
    fireEvent.pointerDown(surface(), { ...base, ...at(3, 3) });
    act(() => vi.advanceTimersByTime(700));
    fireEvent.pointerUp(surface(), { ...base, ...at(3, 3) });
    expect(view().hover).toBeNull();
  });

  it('tapping another candidate moves the pin to it', async () => {
    await mount();
    tap(3, 3);
    await settle();
    tap(15, 15);
    expect(view().hover).toMatchObject({ move: play(15, 15), pinned: true });
  });
});
