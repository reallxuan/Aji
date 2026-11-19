import { createEngineStore } from './engineStore';

it('status reply never overwrites a newer event', () => {
  const store = createEngineStore();
  store
    .getState()
    .applyEvent({ type: 'engineState', engine: { state: 'analysing', version: '1' } });
  store.getState().applyStatus({ state: 'starting' });
  expect(store.getState().engine).toEqual({ state: 'analysing', version: '1' });
});

it('applyStatus before any event applies', () => {
  const store = createEngineStore();
  store.getState().applyStatus({ state: 'starting' });
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
  store.getState().applyStatus({ state: 'analysing', version: '1' });
  expect(store.getState().engine).toEqual({ state: 'analysing', version: '1' });
  expect(store.getState().analysis).toEqual(analysis);
});
