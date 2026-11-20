import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Response } from '../transport/generated/Response';
import { nvidiaHardware, renderSetup, setupTransport } from './testing';
import { useWizardStore } from './wizardStore';

const row = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

describe('StepDetect', () => {
  beforeEach(() => useWizardStore.getState().close());

  it('shows four rows with spinners, then ticks, then moves to the backend step', async () => {
    let answer!: (response: Response) => void;
    const transport = setupTransport({
      setupDetect: () => new Promise((resolve) => (answer = resolve)),
    });
    renderSetup(transport, { step: 'detect' });
    for (const label of ['显卡', '显存', '系统', '驱动']) {
      expect(within(row(label)).getByText('检测中')).toBeInTheDocument();
    }
    expect(screen.getAllByRole('status')).toHaveLength(4);

    answer({ type: 'setupDetect', hardware: nvidiaHardware });
    expect(await screen.findByText('NVIDIA GeForce RTX 5070')).toBeInTheDocument();
    expect(within(row('显存')).getByText('12 GB')).toBeInTheDocument();
    expect(within(row('驱动')).getByText('581.15')).toBeInTheDocument();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(screen.getAllByLabelText('完成')).toHaveLength(4);

    await waitFor(() => expect(useWizardStore.getState().step).toBe('backend'), {
      timeout: 2000,
    });
    expect(useWizardStore.getState().hardware).toEqual(nvidiaHardware);
  });

  it('shows a row whose probe failed as not found, and still moves on', async () => {
    const hardware = {
      ...nvidiaHardware,
      gpus: [{ ...nvidiaHardware.gpus[0], driverVersion: null }],
      problems: ['nvidiaSmi' as const],
    };
    const transport = setupTransport({
      setupDetect: () => ({ type: 'setupDetect', hardware }),
    });
    renderSetup(transport, { step: 'detect' });
    expect(await within(row('驱动')).findByText('未检测到')).toBeInTheDocument();
    await waitFor(() => expect(useWizardStore.getState().step).toBe('backend'), {
      timeout: 2000,
    });
  });
});
