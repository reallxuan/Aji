import { expect, it } from 'vitest';
import type { JobProgress } from '../transport/generated/JobProgress';
import { engineAction } from './engineAction';

const job = (state: JobProgress['state']): JobProgress => ({
  state,
  done: 3,
  total: 10,
  boostDone: 0,
  boostTotal: 0,
  working: 3,
  queued: [4, 5],
  etaSeconds: null,
});

it('engine action pauses during a job', () => {
  const atLimit = { state: 'ready', version: '1.18.2', limitReached: true } as const;
  const analysing = { state: 'analysing', version: '1.18.2' } as const;
  expect(engineAction(atLimit, null)).toBe('continue');
  for (const state of ['running', 'waiting', 'boosting'] as const) {
    expect(engineAction(atLimit, job(state)), state).toBe('pause');
    expect(engineAction(analysing, job(state)), state).toBe('pause');
  }
  // A paused job resumes with the engine; an ended one changes nothing.
  expect(engineAction({ state: 'paused', version: '1.18.2' }, job('paused'))).toBe('resume');
  expect(engineAction(atLimit, job('done'))).toBe('continue');
  expect(engineAction(atLimit, job('stopped'))).toBe('continue');
  expect(engineAction({ state: 'notConfigured' }, job('running'))).toBe('setUp');
});
