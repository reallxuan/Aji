import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nvidiaHardware,
  nvidiaRecommendation,
  oldDriverRecommendation,
  renderSetup,
  setupTransport,
} from './testing';
import { useWizardStore } from './wizardStore';

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
    expect(screen.getByText('NVIDIA GeForce RTX 5070 · 12 GB')).toBeInTheDocument();
  });

  it('keeps CUDA as a disabled row when the driver is too old, with a way to fix it', async () => {
    let recommendation = oldDriverRecommendation;
    const transport = setupTransport({
      setupBackends: () => ({ type: 'setupBackends', recommendation }),
    });
    renderSetup(transport, { step: 'backend', hardware: nvidiaHardware });

    const cuda = await screen.findByRole('radio', { name: /CUDA/ });
    expect(cuda).toBeDisabled();
    expect(cuda.closest('label')).toHaveTextContent('需要更新驱动');
    expect(screen.getByRole('radio', { name: /DirectML/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/566\.36/)).toHaveTextContent('580.00');

    fireEvent.click(screen.getByRole('button', { name: /下载驱动/ }));
    expect(openExternal).toHaveBeenCalledWith('https://www.nvidia.com/drivers/');

    recommendation = nvidiaRecommendation;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重新检测' })));
    expect(transport.requests).toContainEqual({ type: 'setupDetect', refresh: true });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /CUDA/ })).toHaveAttribute('aria-checked', 'true'),
    );
    expect(screen.getByRole('radio', { name: /CUDA/ })).toBeEnabled();
    expect(screen.queryByText('需要更新驱动')).not.toBeInTheDocument();
  });

  it('moves on to the version step with the chosen backend', async () => {
    renderSetup(setupTransport(), { step: 'backend', hardware: nvidiaHardware });
    fireEvent.click(await screen.findByRole('radio', { name: /DirectML/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(useWizardStore.getState()).toMatchObject({ step: 'version', backend: 'directml' });
  });
});
