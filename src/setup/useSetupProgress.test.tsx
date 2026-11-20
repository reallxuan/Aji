import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { TransportProvider } from '../transport/TransportProvider';
import { SetupPanel } from './SetupPanel';
import { gpuFailedJob, runningJob, setupTransport } from './testing';
import { useSetupProgress } from './useSetupProgress';
import { initialWizard, useWizardStore } from './wizardStore';

function Harness() {
  useSetupProgress();
  const open = useWizardStore((s) => s.open);
  return open ? <SetupPanel /> : null;
}

function mount(job: typeof runningJob | null) {
  const transport = setupTransport({ setupStatus: () => ({ type: 'setupStatus', job }) });
  render(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <TransportProvider transport={transport}>
        <Harness />
      </TransportProvider>
    </I18nextProvider>,
  );
  return transport;
}

describe('useSetupProgress (Review Focus 3)', () => {
  beforeEach(() => useWizardStore.setState(initialWizard));

  it('resumes step 5 when a job is running', async () => {
    mount(runningJob);
    expect(await screen.findByText('62%')).toBeInTheDocument();
    expect(useWizardStore.getState()).toMatchObject({ step: 'install', open: true });
  });

  it('opens the failure panel for a job that failed', async () => {
    mount(gpuFailedJob);
    expect(await screen.findByText('KataGo 无法通过此后端使用显卡。')).toBeInTheDocument();
  });

  it('ignores a job that finished before', async () => {
    mount({ ...runningJob, outcome: { outcome: 'installed' } });
    await act(async () => {});
    expect(useWizardStore.getState().open).toBe(false);
  });

  it('follows pushed progress, and an installed outcome closes the wizard', async () => {
    const transport = mount(null);
    await act(async () => {});
    act(() => transport.emit({ type: 'setupProgress', job: runningJob }));
    expect(screen.getByText('62%')).toBeInTheDocument();
    act(() =>
      transport.emit({
        type: 'setupProgress',
        job: { ...runningJob, outcome: { outcome: 'installed' } },
      }),
    );
    expect(useWizardStore.getState()).toMatchObject({ open: false, job: null, dismissed: true });
  });
});
