import { beforeEach, describe, expect, it } from 'vitest';
import { chosen, runningJob, setupTransport } from './testing';
import { initialWizard, useWizardStore } from './wizardStore';

describe('useWizardStore.install', () => {
  beforeEach(() => useWizardStore.setState({ ...initialWizard, ...chosen }));

  it('sends one setupInstall when started twice at once', async () => {
    const transport = setupTransport();
    const { install } = useWizardStore.getState();
    await Promise.all([install(transport, []), install(transport, [])]);
    expect(transport.requests.filter((r) => r.type === 'setupInstall')).toHaveLength(1);
  });

  it('does not start while a job is running', async () => {
    useWizardStore.setState({ job: runningJob });
    const transport = setupTransport();
    await useWizardStore.getState().install(transport, []);
    expect(transport.requests).toHaveLength(0);
  });
});
