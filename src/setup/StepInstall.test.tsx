import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from '../transport/generated/Response';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import { chosen, renderSetup, runningJob, setupTransport } from './testing';
import { useWizardStore } from './wizardStore';

const row = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

describe('StepInstall', () => {
  beforeEach(() => useWizardStore.getState().close());

  it('shows each task as the snapshot reports it', () => {
    renderSetup(setupTransport(), { step: 'install', ...chosen, job: runningJob });
    expect(screen.getByText('正在安装')).toBeInTheDocument();
    expect(within(row('KataGo 引擎')).getByText('完成')).toBeInTheDocument();
    expect(within(row('运行库')).getByText('62%')).toBeInTheDocument();
    expect(within(row('运行库')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62');
    expect(within(row('权重')).getByText('已有')).toBeInTheDocument();
    expect(within(row('测速')).queryByText('完成')).not.toBeInTheDocument();
  });

  it('shows how much of a download has arrived, its total size and its speed', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      const MiB = 1024 * 1024;
      const at = (done: number) => ({
        ...runningJob,
        tasks: runningJob.tasks.map((task) =>
          task.task === 'runtime'
            ? {
                task: 'runtime' as const,
                state: { state: 'running' as const, done, total: 1000 * MiB },
              }
            : task.task === 'benchmark'
              ? {
                  task: 'benchmark' as const,
                  state: { state: 'running' as const, done: 1, total: 3 },
                }
              : task,
        ),
      });
      vi.setSystemTime(0);
      renderSetup(setupTransport(), { step: 'install', ...chosen, job: at(600 * MiB) });
      expect(within(row('运行库')).getByText('600 MB / 1000 MB')).toBeInTheDocument();
      expect(within(row('运行库')).queryByText(/\/s/)).not.toBeInTheDocument();
      // Counts are not sizes: the benchmark row shows no amounts.
      expect(within(row('测速')).queryByText(/MB/)).not.toBeInTheDocument();

      vi.setSystemTime(2000);
      act(() => useWizardStore.setState({ job: at(604 * MiB) }));
      // One line: the speed and the time left in brackets after the amount. 396 MB at 2 MB/s
      // is 198 s, shown as 4 minutes.
      expect(
        within(row('运行库')).getByText('604 MB / 1000 MB（2 MB/s，还需 4 分钟）'),
      ).toBeInTheDocument();

      // A stalled download sends no snapshots. The line samples on its own each second, so the
      // speed falls to nothing and the time left goes.
      act(() => vi.advanceTimersByTime(4000));
      expect(within(row('运行库')).getByText('604 MB / 1000 MB（0 B/s）')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what the benchmark is doing: starting, then each thread count and its result', () => {
    const benchmarking = (done: number, benchmark: JobSnapshot['benchmark']): JobSnapshot => ({
      ...runningJob,
      tasks: runningJob.tasks.map((task) =>
        task.task === 'benchmark'
          ? { task: 'benchmark', state: { state: 'running', done, total: 15 } }
          : task.task === 'testQuery'
            ? task
            : { task: task.task, state: { state: 'done' } },
      ),
      benchmark,
    });
    renderSetup(setupTransport(), {
      step: 'install',
      ...chosen,
      job: benchmarking(0, { testing: null, positionsDone: 0, tested: [] }),
    });
    expect(within(row('测速')).getByText('正在启动 KataGo，加载权重')).toBeInTheDocument();

    act(() =>
      useWizardStore.setState({
        job: benchmarking(7, {
          testing: 16,
          positionsDone: 2,
          tested: [{ threads: 8, visitsPerSecond: 100.4 }],
        }),
      }),
    );
    const benchmark = row('测速');
    expect(within(benchmark).getByText('正在测试 16 个搜索线程')).toBeInTheDocument();
    expect(within(benchmark).getByText('8 个线程：100 次/秒')).toBeInTheDocument();
    expect(within(benchmark).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '46');
  });

  it('offers only Cancel while the job runs, and Cancel sends setupCancel', async () => {
    const transport = setupTransport();
    renderSetup(transport, { step: 'install', ...chosen, job: runningJob });
    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['取消']);
    await act(async () => fireEvent.click(within(footer).getByRole('button', { name: '取消' })));
    expect(transport.requests).toContainEqual({ type: 'setupCancel' });
  });

  it('after a cancel shows Cancelled with Retry, Back and Set up later', () => {
    renderSetup(setupTransport(), {
      step: 'install',
      ...chosen,
      job: { ...runningJob, outcome: { outcome: 'cancelled' } },
    });
    expect(screen.getByText('已取消')).toBeInTheDocument();
    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['暂不设置', '返回', '重试']);
  });

  it('a failed row turns red', () => {
    renderSetup(setupTransport(), {
      step: 'install',
      ...chosen,
      job: {
        ...runningJob,
        tasks: [{ task: 'engine', state: { state: 'failed', failure: 'downloadFailed' } }],
        outcome: null,
      },
    });
    expect(within(row('KataGo 引擎')).getByText('失败')).toHaveClass('text-engine-error');
  });

  it('two fast clicks on Start install send one setupInstall (Review Focus 2)', async () => {
    const transport = setupTransport();
    renderSetup(transport, { step: 'network', ...chosen }, { strict: true });
    const start = await screen.findByRole('button', { name: '开始安装' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(useWizardStore.getState().step).toBe('install'));
    await act(async () => {});
    expect(transport.requests.filter((r) => r.type === 'setupInstall')).toHaveLength(1);
  });

  it('a setupBusy rejection shows the job already running (Review Focus 2)', async () => {
    const transport = setupTransport({
      setupInstall: (): Response => {
        throw { code: 'setupBusy', message: 'a job is running' };
      },
      setupStatus: () => ({ type: 'setupStatus', job: runningJob }),
    });
    renderSetup(transport, { step: 'licence', ...chosen });
    expect(await screen.findByText('62%')).toBeInTheDocument();
    expect(useWizardStore.getState()).toMatchObject({ step: 'install', starting: false });
  });
});
