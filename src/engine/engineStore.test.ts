import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { EngineState } from '../transport/generated/EngineState';
import { createEngineStore } from './engineStore';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';

function status(engine: EngineState, position = A, analysis: AnalysisUpdate | null = null) {
  return { engine, position, analysis };
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
  const analysis = {
    position: 'ab',
    boardSize: 19,
    rootVisits: 5,
    winrate: 0.5,
    scoreLead: 0,
    isFinal: false,
    candidates: [],
  };
  store.getState().applyEvent({ type: 'analysisUpdate', analysis });
  expect(store.getState().analysis).toEqual(analysis);
});

it('an analysis update does not block the status reply', () => {
  const store = createEngineStore();
  const analysis = {
    position: 'ab',
    boardSize: 19,
    rootVisits: 5,
    winrate: 0.5,
    scoreLead: 0,
    isFinal: false,
    candidates: [],
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
      benchmark: null,
    },
  });
  expect(store.getState()).toBe(before);
});
