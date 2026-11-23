import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { JobProgress } from '../transport/generated/JobProgress';
import { resetJobStore, useJobStore } from './jobStore';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  resetJobStore();
  vi.useRealTimers();
});

const progress = (state: JobProgress['state'], done = 3): JobProgress => ({
  state,
  done,
  total: 10,
  boostDone: 0,
  boostTotal: 0,
  working: null,
  queued: [],
  etaSeconds: null,
});

it('job store keeps done for four seconds', () => {
  const store = useJobStore.getState();
  store.apply(progress('running'));
  expect(useJobStore.getState()).toMatchObject({ progress: progress('running'), doneUntil: null });
  store.apply(progress('done', 10));
  const { doneUntil } = useJobStore.getState();
  expect(doneUntil).toBe(Date.now() + 4000);
  vi.advanceTimersByTime(3999);
  expect(useJobStore.getState().progress?.state).toBe('done');
  vi.advanceTimersByTime(1);
  expect(useJobStore.getState()).toMatchObject({ progress: null, doneUntil: null });
});

it('a stopped job also clears after four seconds, and a new job cancels the clearing', () => {
  const store = useJobStore.getState();
  store.apply(progress('stopped'));
  vi.advanceTimersByTime(2000);
  store.apply(progress('running', 0));
  vi.advanceTimersByTime(5000);
  expect(useJobStore.getState().progress?.state).toBe('running');
});

it('the strip shows from a job start until the game changes', () => {
  const store = useJobStore.getState();
  expect(useJobStore.getState().strip).toBe(false);
  store.apply(progress('running'));
  expect(useJobStore.getState().strip).toBe(true);
  store.apply(progress('done', 10));
  vi.advanceTimersByTime(4000);
  // The status goes; the strip stays, all solid.
  expect(useJobStore.getState()).toMatchObject({ progress: null, strip: true });
  store.hideStrip();
  expect(useJobStore.getState().strip).toBe(false);
  // A late status from the closed game's job does not bring it back.
  store.apply(progress('stopped'));
  expect(useJobStore.getState().strip).toBe(false);
});
