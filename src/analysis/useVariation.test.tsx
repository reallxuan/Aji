import { act, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createEngineStore, EngineStoreProvider, type EngineStore } from '../engine/engineStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { createFakeTransport } from '../transport/fake';
import type { Move } from '../transport/generated/Move';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { TransportProvider } from '../transport/TransportProvider';
import { useVariation } from './useVariation';
import { resetViewStore, useViewStore } from './viewStore';

afterEach(() => {
  resetGameStore();
  resetViewStore();
});

const KEY = 'cdcdcdcdcdcdcdcd';
const p = (x: number, y: number): Move => ({ type: 'play', x, y });

function update(engine: EngineStore, ...lines: Move[][]) {
  engine.getState().applyEvent({
    type: 'analysisUpdate',
    analysis: {
      position: KEY,
      boardSize: 19,
      rootVisits: 500,
      winrate: 0.5,
      scoreLead: 0,
      isFinal: false,
      candidates: lines.map((pv, order) => ({
        move: pv[0],
        order,
        visits: 400 - order * 50,
        winrate: 0.5,
        scoreLead: 0,
        prior: 0.5,
        pv,
      })),
      previousVisits: 0,
      ownership: null,
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function mount(answer: (moves: Move[]) => Response | Promise<Response> = preview) {
  const requests: Move[][] = [];
  const transport = createFakeTransport((request: Request) => {
    if (request.type !== 'gamePreview') throw new Error(request.type);
    requests.push(request.moves);
    return answer(request.moves);
  });
  const engine = createEngineStore();
  useGameStore.getState().bindEngine(engine);
  useGameStore
    .getState()
    .apply(makeSnapshot({ revision: 1, positionKey: KEY, nextColor: 'white' }));
  function Probe() {
    useVariation();
    return null;
  }
  render(
    <TransportProvider transport={transport}>
      <EngineStoreProvider store={engine}>
        <Probe />
      </EngineStoreProvider>
    </TransportProvider>,
  );
  return { engine, requests };
}

function preview(moves: Move[]): Response {
  return {
    type: 'gamePreview',
    preview: { stones: [], captured: moves.map(() => []), illegalAt: null },
  };
}

const hover = (move: Move | null) =>
  act(async () => useViewStore.getState().setHover(move ? { move, source: 'board' } : null));

it('freezes the line while hovering', async () => {
  const { engine, requests } = mount();
  update(engine, [p(3, 3), p(4, 4)]);
  await hover(p(3, 3));
  expect(useViewStore.getState().variation).toMatchObject({
    moves: [p(3, 3), p(4, 4)],
    colors: ['white', 'black'],
  });
  expect(useViewStore.getState().step).toBe(2);
  act(() => update(engine, [p(3, 3), p(5, 5), p(6, 6)]));
  await act(async () => {});
  expect(useViewStore.getState().variation?.moves).toEqual([p(3, 3), p(4, 4)]);
  expect(requests).toHaveLength(1);
});

it('follows the hovered move, not its rank, when the order changes', async () => {
  const { engine, requests } = mount();
  update(engine, [p(3, 3), p(4, 4)], [p(9, 9), p(8, 8)]);
  await hover(p(9, 9));
  expect(useViewStore.getState().variation?.moves).toEqual([p(9, 9), p(8, 8)]);
  act(() => update(engine, [p(9, 9), p(7, 7)], [p(3, 3), p(4, 4)]));
  await act(async () => {});
  expect(useViewStore.getState().variation?.moves).toEqual([p(9, 9), p(8, 8)]);
  expect(requests).toHaveLength(1);
});

it('takes the new line after leaving and coming back', async () => {
  const { engine, requests } = mount();
  update(engine, [p(3, 3), p(4, 4)]);
  await hover(p(3, 3));
  act(() => update(engine, [p(3, 3), p(5, 5), p(6, 6)]));
  await hover(null);
  expect(useViewStore.getState().variation).toBeNull();
  expect(useViewStore.getState().step).toBeNull();
  await hover(p(3, 3));
  expect(useViewStore.getState().variation?.moves).toEqual([p(3, 3), p(5, 5), p(6, 6)]);
  expect(useViewStore.getState().step).toBe(3);
  expect(requests).toHaveLength(2);
});

it('a hover ends when its candidate is no longer shown', async () => {
  const { engine } = mount();
  update(engine, [p(3, 3), p(4, 4)], [p(9, 9), p(8, 8)]);
  await hover(p(9, 9));
  act(() => update(engine, [p(3, 3), p(4, 4)]));
  await act(async () => {});
  expect(useViewStore.getState().hover).toBeNull();
  expect(useViewStore.getState().variation).toBeNull();
});

for (const [name, hide] of [
  ['F', () => useViewStore.getState().toggleHidden()],
  ['Z', () => useViewStore.getState().setHeld(true)],
] as const) {
  it(`${name} ends the hover with the candidates`, async () => {
    const { engine } = mount();
    update(engine, [p(3, 3), p(4, 4)]);
    await hover(p(3, 3));
    act(hide);
    await act(async () => {});
    expect(useViewStore.getState().hover).toBeNull();
    expect(useViewStore.getState().variation).toBeNull();
  });
}

it('a new snapshot ends the hover and drops a late preview', async () => {
  const reply = deferred<Response>();
  const { engine } = mount(() => reply.promise);
  update(engine, [p(3, 3), p(4, 4)]);
  await hover(p(3, 3));
  act(() =>
    useGameStore.getState().apply(makeSnapshot({ revision: 2, positionKey: 'eeeeeeeeeeeeeeee' })),
  );
  expect(useViewStore.getState().hover).toBeNull();
  await act(async () => reply.resolve(preview([p(3, 3), p(4, 4)])));
  expect(useViewStore.getState().variation).toBeNull();
});
