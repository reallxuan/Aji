import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  nvidiaHardware,
  nvidiaRecommendation,
  renderSetup,
  setupTransport,
  versions,
} from './testing';
import { useWizardStore } from './wizardStore';

describe('StepVersion', () => {
  beforeEach(() => useWizardStore.getState().close());

  it('lists versions newest first, the newest chosen and tagged latest', async () => {
    const transport = setupTransport();
    renderSetup(transport, {
      step: 'version',
      hardware: nvidiaHardware,
      recommendation: nvidiaRecommendation,
      backend: 'cuda',
    });
    const radios = await screen.findAllByRole('radio');
    expect(radios[0].closest('label')).toHaveTextContent('1.18.2最新');
    expect(radios[1].closest('label')).not.toHaveTextContent('最新');
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(transport.requests).toContainEqual({ type: 'setupVersions', backend: 'cuda' });
    expect(screen.getByText('CUDA · Windows x64')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(useWizardStore.getState()).toMatchObject({
      step: 'network',
      engine: 'katago-v1.18.2-cuda13.2-windows-x64',
    });
  });

  it('marks a version that is already downloaded', async () => {
    const transport = setupTransport({
      setupVersions: () => ({
        type: 'setupVersions',
        versions: versions.map((v, i) => ({ ...v, installed: i === 1 })),
      }),
    });
    renderSetup(transport, { step: 'version', backend: 'cuda' });
    const radios = await screen.findAllByRole('radio');
    expect(radios[1].closest('label')).toHaveTextContent('已下载');
    expect(radios[0].closest('label')).not.toHaveTextContent('已下载');
  });

  it('goes back to the backend step keeping the choice', async () => {
    renderSetup(setupTransport(), {
      step: 'version',
      recommendation: nvidiaRecommendation,
      backend: 'directml',
    });
    fireEvent.click(await screen.findByRole('button', { name: '上一步' }));
    expect(useWizardStore.getState()).toMatchObject({ step: 'backend', backend: 'directml' });
  });
});
