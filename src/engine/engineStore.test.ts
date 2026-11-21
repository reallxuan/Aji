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
