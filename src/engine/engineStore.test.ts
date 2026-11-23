import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { EngineState } from '../transport/generated/EngineState';
import { createEngineStore } from './engineStore';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';

function status(
  engine: EngineState,
  position: string | null = A,
  analysis: AnalysisUpdate | null = null,
) {
  return { engine, position, analysis, rejected: null, running: null };
}

function update(position: string, rootVisits: number): AnalysisUpdate {
  return {
    position,
    boardSize: 19,
    rootVisits,
    winrate: 0.5,
    scoreLead: 0,
    isFinal: false,
    candidates: [],
    previousVisits: 0,
    ownership: null,
    next: null,
  };
}

it('status reply never overwrites a newer event', () => {
  const store = createEngineStore();
  store
    .getState()
    .applyEvent({ type: 'engineState', engine: { state: 'analysing', version: '1' } });
  store.getState().applyStatus(status({ state: 'starting' }));
  expect(store.getState().engine).toEqual({ state: 'analysing', version: '1' });
});

it('applyStatus before any event applies', () => {
  const store = createEngineStore();
  store.getState().applyStatus(status({ state: 'starting' }));
  expect(store.getState().engine).toEqual({ state: 'starting' });
});

it('keeps the latest analysis update', () => {
  const store = createEngineStore();
  store.getState().setPosition('ab');
  const analysis = {
    position: 'ab',
    boardSize: 19,
    rootVisits: 5,
    winrate: 0.5,
    scoreLead: 0,
    isFinal: false,
    candidates: [],
    previousVisits: 0,
    ownership: null,
    next: null,
  };
  store.getState().applyEvent({ type: 'analysisUpdate', analysis });
  expect(store.getState().analysis).toEqual(analysis);
});

it('an analysis update does not block the status reply', () => {
  const store = createEngineStore();
  store.getState().setPosition('ab');
  const analysis = {
    position: 'ab',
    boardSize: 19,
    rootVisits: 5,
    winrate: 0.5,
    scoreLead: 0,
    isFinal: false,
    candidates: [],
    previousVisits: 0,
    ownership: null,
    next: null,
  };
  store.getState().applyEvent({ type: 'analysisUpdate', analysis });
  store.getState().applyStatus(status({ state: 'analysing', version: '1' }));
  expect(store.getState().engine).toEqual({ state: 'analysing', version: '1' });
  expect(store.getState().analysis).toEqual(analysis);
});

it('update for another position is ignored', () => {
  const store = createEngineStore();
  store.getState().applyStatus(status({ state: 'starting' }, A));
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(B, 10) });
  expect(store.getState().analysis).toBeNull();
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(A, 10) });
  expect(store.getState().analysis?.position).toBe(A);
});

it('status reply shows the latest analysis', () => {
  const store = createEngineStore();
  store.getState().applyStatus(status({ state: 'starting' }, A, update(A, 300)));
  expect(store.getState().analysis?.rootVisits).toBe(300);
});

it('status analysis never overwrites a newer update', () => {
  const store = createEngineStore();
  store.getState().setPosition(A);
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(A, 500) });
  store.getState().applyStatus(status({ state: 'analysing', version: '1' }, A, update(A, 300)));
  expect(store.getState().analysis?.rootVisits).toBe(500);
});

it('status analysis for a different position is ignored', () => {
  const store = createEngineStore();
  store.getState().setPosition(A);
  store.getState().applyStatus(status({ state: 'starting' }, B, update(B, 300)));
  expect(store.getState().analysis).toBeNull();
});

it('setPosition clears the analysis only when the key changes', () => {
  const store = createEngineStore();
  store.getState().setPosition(A);
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(A, 5) });
  store.getState().setPosition(A);
  expect(store.getState().analysis).not.toBeNull();
  store.getState().setPosition(B);
  expect(store.getState().analysis).toBeNull();
});

it('a setup progress event leaves the engine store alone', () => {
  const store = createEngineStore();
  store.getState().applyStatus(status({ state: 'starting' }));
  const before = store.getState();
  store.getState().applyEvent({
    type: 'setupProgress',
    job: {
      id: 1,
      engine: 'e',
      backend: 'metal',
      network: 'n',
      tasks: [],
      outcome: null,
      measures: false,
      benchmark: null,
    },
  });
  expect(store.getState()).toBe(before);
});

it('no update is accepted before a position is known', () => {
  const store = createEngineStore();
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(A, 5) });
  expect(store.getState().analysis).toBeNull();
  store.getState().applyStatus(status({ state: 'analysing', version: '1' }, A));
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(A, 6) });
  expect(store.getState().analysis?.rootVisits).toBe(6);
});

it('clearPosition drops the analysis and ignores late updates', () => {
  const store = createEngineStore();
  store.getState().setPosition(A);
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(A, 5) });
  store.getState().clearPosition();
  expect(store.getState().position).toBeNull();
  expect(store.getState().analysis).toBeNull();
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(A, 9) });
  expect(store.getState().analysis).toBeNull();
  // A status reply that still names the old position does not bring it back.
  store
    .getState()
    .applyStatus(status({ state: 'ready', version: '1', limitReached: false }, A, update(A, 9)));
  expect(store.getState().position).toBeNull();
  expect(store.getState().analysis).toBeNull();
  store.getState().setPosition(A);
  store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(A, 10) });
  expect(store.getState().analysis?.rootVisits).toBe(10);
});

it('a status reply with no position sets none', () => {
  const store = createEngineStore();
  store.getState().applyStatus(status({ state: 'ready', version: '1', limitReached: false }, null));
  expect(store.getState().position).toBeNull();
});

describe('speed', () => {
  function analysing() {
    let now = 0;
    const store = createEngineStore(() => now);
    store.getState().setPosition(A);
    store
      .getState()
      .applyEvent({ type: 'engineState', engine: { state: 'analysing', version: '1' } });
    const at = (ms: number, visits: number, position = A) => {
      now = ms;
      store.getState().applyEvent({ type: 'analysisUpdate', analysis: update(position, visits) });
    };
    return { store, at };
  }

  it('is measured over the last second', () => {
    const { store, at } = analysing();
    at(0, 100);
    at(500, 600);
    expect(store.getState().speed).toBe(1000);
    // Samples older than a second fall out of the window.
    at(1400, 1000);
    at(1600, 1100);
    expect(store.getState().speed).toBe(500);
  });

  it('is null on one sample, after a restart, and for a new search', () => {
    const { store, at } = analysing();
    at(0, 100);
    expect(store.getState().speed).toBeNull();
    at(500, 600);
    store.getState().applyEvent({ type: 'engineState', engine: { state: 'starting' } });
    expect(store.getState().speed).toBeNull();
    store
      .getState()
      .applyEvent({ type: 'engineState', engine: { state: 'analysing', version: '1' } });
    at(600, 50);
    expect(store.getState().speed).toBeNull();
    at(700, 150);
    expect(store.getState().speed).toBe(1000);
    // Fewer visits than the last sample: a new search began, so its samples start over.
    at(800, 20);
    expect(store.getState().speed).toBeNull();
  });

  it('starts over on a new position and ignores a zero time span', () => {
    const { store, at } = analysing();
    at(0, 100);
    at(0, 200);
    expect(store.getState().speed).toBeNull();
    at(500, 600);
    store.getState().setPosition(B);
    expect(store.getState().speed).toBeNull();
    at(600, 900, B);
    expect(store.getState().speed).toBeNull();
  });
});

it('rejection follows the position', () => {
  const store = createEngineStore();
  const rejected = (position: string) =>
    store.getState().applyEvent({
      type: 'analysisRejected',
      rejection: { position, message: 'Illegal move' },
    });
  store.getState().setPosition(A);
  rejected(B);
  expect(store.getState().rejected).toBeNull();
  rejected(A);
  expect(store.getState().rejected).toEqual({ position: A, message: 'Illegal move' });
  store.getState().setPosition(B);
  expect(store.getState().rejected).toBeNull();
  store.getState().applyStatus({
    ...status({ state: 'ready', version: '1', limitReached: false }, B),
    rejected: { position: B, message: 'superko' },
  });
  expect(store.getState().rejected?.message).toBe('superko');
  store.getState().clearPosition();
  expect(store.getState().rejected).toBeNull();
});

it('a status rejection for another position is ignored', () => {
  const store = createEngineStore();
  store.getState().setPosition(A);
  store.getState().applyStatus({
    ...status({ state: 'ready', version: '1', limitReached: false }, A),
    rejected: { position: B, message: 'superko' },
  });
  expect(store.getState().rejected).toBeNull();
});
