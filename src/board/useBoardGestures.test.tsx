import { createI18n } from '../i18n/createI18n';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { candidate, play, subBoardHarness } from '../analysis/subBoardTesting';
import { resetViewStore, useViewStore } from '../analysis/viewStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { MainBoard } from '../layout/MainBoard';
import { resetScoringStore, useScoringStore } from '../scoring/scoringStore';
import type { Color } from '../transport/generated/Color';
import type { Request } from '../transport/generated/Request';
import { boardGeometry } from './geometry';

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame'] }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
  resetViewStore();
  resetScoringStore();
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

describe('final scoring on the main board', () => {
  /** A black pair at D16 and D15, a white stone at Q4; KataGo reads the pair as dead. */
  const STONES: (Color | null)[] = Array.from({ length: 361 }, () => null);
  STONES[3 * 19 + 3] = 'black';
  STONES[4 * 19 + 3] = 'black';
  STONES[15 * 19 + 15] = 'white';
  const PAIR = [
    { x: 3, y: 3 },
    { x: 3, y: 4 },
  ];
  const owners = STONES.map((_, i): Color | null => (i % 19 < 10 ? 'white' : null));

  async function scoring() {
    const h = subBoardHarness((request: Request) =>
      request.type === 'gameScore'
        ? {
            type: 'score',
            suggestedDead: PAIR,
            black: { stones: 0, territory: 0, dead: 0, prisoners: 0, total: 0 },
            white: { stones: 1, territory: 188, dead: 2, prisoners: 0, total: 198.5 },
            komi: 7.5,
            margin: -198.5,
            owners,
            openByOwnership: false,
          }
        : undefined,
    );
    const { snapshot } = useGameStore.getState();
    useGameStore.getState().apply({ ...snapshot!, revision: 2, stones: STONES, atEnd: true });
    render(
      <h.wrapper>
        <MainBoard rect={{ x: 0, y: 0, width: SIZE, height: SIZE }} />
      </h.wrapper>,
    );
    h.analyse([candidate(0, 0.55, LINE), candidate(1, 0.5, OTHER)]);
    await settle();
    await act(() =>
      useScoringStore
        .getState()
        .start({ transport: h.transport, engine: h.engine, t: createI18n('en').t }),
    );
    const scored = () =>
      h.requests
        .filter((r) => r.type === 'gameScore')
        .map((r) => (r as Extract<Request, { type: 'gameScore' }>).mode);
    return { ...h, scored };
  }
  const layer = (name: string) =>
    document
      .querySelector<HTMLCanvasElement>(`canvas[data-layer="${name}"]`)!
      .getContext('2d') as unknown as {
      __getDrawCalls(): Array<{ type: string }>;
      __clearDrawCalls(): void;
    };

  it('hides the candidates and shows the count on the board', async () => {
    const h = await scoring();
    expect(useScoringStore.getState().dead).toEqual(PAIR);
    const candidates = layer('candidates');
    candidates.__clearDrawCalls();
    // A newer update would draw its discs; while scoring the layer stays empty.
    h.analyse([candidate(0, 0.6, OTHER), candidate(1, 0.5, LINE)]);
    await settle();
    expect(candidates.__getDrawCalls().filter((c) => c.type === 'fill')).toHaveLength(0);
    // Every owned point but White's living stone gets a square.
    const squares = layer('ownership')
      .__getDrawCalls()
      .filter((c) => c.type === 'fillRect');
    expect(squares.length).toBeGreaterThanOrEqual(owners.filter(Boolean).length);
  });

  it('tapping_a_stone_toggles_its_group_and_rescores', async () => {
    const { scored } = await scoring();
    // A mouse click on either stone of the dead pair brings both back.
    fireEvent.click(surface(), at(3, 3));
    await settle();
    expect(scored().at(-1)).toEqual({ kind: 'final', dead: [] });
    // A tap does the same, the other way.
    tap(3, 4);
    await settle();
    expect(scored().at(-1)).toEqual({ kind: 'final', dead: expect.arrayContaining(PAIR) });
    // A tap on an empty point counts nothing again, and pins no line.
    const asked = scored().length;
    tap(9, 9);
    await settle();
    expect(scored()).toHaveLength(asked);
    expect(view().hover).toBeNull();
  });

  it('moving to another position leaves scoring', async () => {
    const h = await scoring();
    const { snapshot } = useGameStore.getState();
    await act(async () => {
      useGameStore.getState().apply({ ...snapshot!, revision: 3, moveNumber: 5, lineIndex: 5 });
    });
    expect(useScoringStore.getState().active).toBe(false);
    expect(h.requests.at(-1)?.type).toBe('analysisResume');
  });

  it('a change of rules counts again', async () => {
    const { scored } = await scoring();
    const asked = scored().length;
    const { snapshot } = useGameStore.getState();
    const rules = { kind: 'japaneseKorean' } as const;
    await act(async () => {
      useGameStore.getState().apply({
        ...snapshot!,
        revision: 3,
        rules: { ...snapshot!.rules, current: rules },
      });
    });
    expect(useScoringStore.getState().active).toBe(true);
    expect(scored()).toHaveLength(asked + 1);
  });
});
