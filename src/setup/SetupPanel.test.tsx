import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings/settingsStore';
import { nvidiaRecommendation, renderSetup, setupTransport, versions } from './testing';
import { useWizardStore } from './wizardStore';

describe('SetupPanel', () => {
  beforeEach(() => {
    useWizardStore.getState().close();
    useSettingsStore.setState({ settings: null });
  });

  it('switches language from the title row, keeping the step and the choices (Review Focus 1)', async () => {
    const transport = setupTransport();
    renderSetup(transport, {
      step: 'version',
      recommendation: nvidiaRecommendation,
      backend: 'directml',
      versions,
      engine: versions[1].engine,
    });
    expect(await screen.findByText('选择 KataGo 版本')).toBeInTheDocument();
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'EN' })));
    expect(await screen.findByText('Choose a KataGo version')).toBeInTheDocument();
    expect(useWizardStore.getState()).toMatchObject({
      step: 'version',
      backend: 'directml',
      engine: versions[1].engine,
    });
    expect(screen.getByRole('radio', { name: /1\.18\.1/ })).toHaveAttribute('aria-checked', 'true');
    expect(transport.requests).toContainEqual({
      type: 'settingsSet',
      settings: expect.objectContaining({ language: 'en' }),
    });
  });

  it('shows the four-part progress line: hardware and backend, version, network, install', () => {
    renderSetup(setupTransport(), { step: 'version', backend: 'cuda' });
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuemax', '4');
    expect(progress).toHaveAttribute('aria-valuenow', '2');
  });
});
