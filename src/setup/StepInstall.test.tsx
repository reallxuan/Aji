import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Response } from '../transport/generated/Response';
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
