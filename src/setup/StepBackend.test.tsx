import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Response } from '../transport/generated/Response';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nvidiaHardware,
  nvidiaRecommendation,
  oldDriverRecommendation,
  renderSetup,
  setupTransport,
} from './testing';
import { useWizardStore } from './wizardStore';

const row = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

const openExternal = vi.fn<(url: string) => Promise<void>>(async () => {});
vi.mock('../platform/openExternal', () => ({ openExternal: (url: string) => openExternal(url) }));

describe('StepBackend', () => {
  beforeEach(() => {
    useWizardStore.getState().close();
    openExternal.mockClear();
  });

  it('lists the recommendation in order with its tags, the default chosen', async () => {
    renderSetup(setupTransport(), { step: 'backend', hardware: nvidiaHardware });
    const radios = await screen.findAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
      'CUDA最快',
      'DirectML免运行库',
      'OpenCL兼容性最好，最慢',
      '处理器（AVX2）仅用处理器',
    ]);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(useWizardStore.getState().backend).toBe('cuda');
    // The hardware sits above the list, so the old one-line subtitle is gone.
    expect(within(row('显卡')).getByText('NVIDIA GeForce RTX 5070')).toBeInTheDocument();
    expect(within(row('显存')).getByText('12 GB')).toBeInTheDocument();
    expect(screen.queryByText('NVIDIA GeForce RTX 5070 · 12 GB')).not.toBeInTheDocument();
  });

  it('detects the hardware on the same page, then lists the backends', async () => {
    let answer!: (response: Response) => void;
    const transport = setupTransport({
      setupDetect: () => new Promise((resolve) => (answer = resolve)),
    });
    renderSetup(transport);
    expect(useWizardStore.getState().step).toBe('backend');
    for (const label of ['显卡', '显存', '系统', '驱动']) {
      expect(within(row(label)).getByText('检测中')).toBeInTheDocument();
    }
    expect(screen.getAllByRole('status')).toHaveLength(4);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(transport.requests.some((r) => r.type === 'setupBackends')).toBe(false);

    answer({ type: 'setupDetect', hardware: nvidiaHardware });
    expect(await screen.findAllByRole('radio')).toHaveLength(4);
    expect(within(row('驱动')).getByText('581.15')).toBeInTheDocument();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(screen.getAllByLabelText('完成')).toHaveLength(4);
    expect(useWizardStore.getState()).toMatchObject({ step: 'backend', hardware: nvidiaHardware });
  });

  it('shows a row whose probe failed as not found', async () => {
    const hardware = {
      ...nvidiaHardware,
      gpus: [{ ...nvidiaHardware.gpus[0], driverVersion: null }],
      problems: ['nvidiaSmi' as const],
    };
    renderSetup(setupTransport({ setupDetect: () => ({ type: 'setupDetect', hardware }) }));
    expect(await within(row('驱动')).findByText('未检测到')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '选择后端' })).toBeInTheDocument();
    expect(await screen.findAllByRole('radio')).toHaveLength(4);
  });

  it('keeps CUDA as a disabled row when the driver is too old, with a way to fix it', async () => {
    let recommendation = oldDriverRecommendation;
    let driverVersion = '566.36';
    const transport = setupTransport({
      setupDetect: () => ({
        type: 'setupDetect',
        hardware: { ...nvidiaHardware, gpus: [{ ...nvidiaHardware.gpus[0], driverVersion }] },
      }),
      setupBackends: () => ({ type: 'setupBackends', recommendation }),
    });
    renderSetup(transport);

    const cuda = await screen.findByRole('radio', { name: /CUDA/ });
    expect(cuda).toBeDisabled();
    expect(cuda.closest('label')).toHaveTextContent('需要更新驱动');
    expect(screen.getByRole('radio', { name: /DirectML/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/566\.36.*580\.00/)).toBeInTheDocument();
    expect(within(row('驱动')).getByText('566.36')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /下载驱动/ }));
    expect(openExternal).toHaveBeenCalledWith('https://www.nvidia.com/drivers/');

    recommendation = nvidiaRecommendation;
    driverVersion = '581.15';
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新检测' })));
    expect(transport.requests).toContainEqual({ type: 'setupDetect', refresh: true });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /CUDA/ })).toHaveAttribute('aria-checked', 'true'),
    );
    expect(screen.getByRole('radio', { name: /CUDA/ })).toBeEnabled();
    expect(screen.queryByText('需要更新驱动')).not.toBeInTheDocument();
    // Detecting again refreshes the hardware rows too.
    expect(within(row('驱动')).getByText('581.15')).toBeInTheDocument();
  });

  it('moves on to the version step with the chosen backend', async () => {
    renderSetup(setupTransport(), { step: 'backend', hardware: nvidiaHardware });
    fireEvent.click(await screen.findByRole('radio', { name: /DirectML/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(useWizardStore.getState()).toMatchObject({ step: 'version', backend: 'directml' });
  });
});
