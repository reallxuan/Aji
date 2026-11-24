import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { resetJobStore, useJobStore } from '../job/jobStore';
import type { JobProgress } from '../transport/generated/JobProgress';
import type { Request } from '../transport/generated/Request';
import { JobStatus } from './JobStatus';

afterEach(() => {
  resetJobStore();
  resetGameStore();
});

const progress = (state: JobProgress['state'], extra: Partial<JobProgress> = {}): JobProgress => ({
  state,
  done: 158,
  total: 248,
  boostDone: 0,
  boostTotal: 0,
  working: '00000000000000a0',
  queued: ['00000000000000a1'],
  etaSeconds: 110,
  ...extra,
});

function mount() {
  return renderWithGame(<JobStatus />, {
    answer: (request: Request) => (request.type === 'jobStop' ? { type: 'ok' } : undefined),
  });
}

const status = () => screen.queryByTestId('job-status');
const show = (p: JobProgress) => act(() => useJobStore.getState().apply(p));

it('status reads each state', () => {
  mount();
  expect(status()).toBeNull();
  show(progress('running'));
  expect(status()).toHaveTextContent('分析全局 158/248');
  expect(status()).toHaveTextContent('约 2 分钟');
  show(progress('waiting'));
  expect(status()).toHaveTextContent('分析全局 158/248');
  expect(status()).toHaveTextContent('先算当前局面');
  show(progress('paused'));
  expect(status()).toHaveTextContent('已暂停 158/248');
  show(progress('boosting', { done: 248, boostDone: 3, boostTotal: 9, etaSeconds: 50 }));
  expect(status()).toHaveTextContent('加强分析 3/9');
  expect(status()).toHaveTextContent('不到 1 分钟');
  show(progress('running', { etaSeconds: null }));
  expect(status()).not.toHaveTextContent('分钟');
  show(progress('stopped'));
  expect(status()).toHaveTextContent('已停止');
  show(progress('done', { done: 248 }));
  expect(status()).toHaveTextContent('已分析全局');
  // Nothing to stop once it has ended.
  expect(screen.queryByRole('button')).toBeNull();
  expect(status()!.textContent).not.toContain('·');
});

it('the x stops the job', async () => {
  const { requests } = mount();
  show(progress('running'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '停止全局分析' }));
  });
  expect(requests).toContainEqual({ type: 'jobStop' });
});
