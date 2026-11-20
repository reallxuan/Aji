import { useEffect } from 'react';
import { getInstallStatus } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { useWizardStore } from './wizardStore';

/**
 * Follows install progress. On mount it asks for the current job, so a window reload during an
 * install, or after one failed, comes back to step 5; an older finished or cancelled job is left
 * alone. It subscribes first, so a snapshot pushed meanwhile wins over the status reply.
 */
export function useSetupProgress(): void {
  const transport = useTransport();

  useEffect(() => {
    let active = true;
    const unsubscribe = transport.subscribe((event) => {
      if (active && event.type === 'setupProgress') {
        useWizardStore.getState().applyProgress(event.job);
      }
    });
    getInstallStatus(transport).then(
      (job) => {
        if (!active || !job || useWizardStore.getState().job) return;
        if (job.outcome === null || job.outcome.outcome === 'failed') {
          useWizardStore.getState().applyProgress(job);
        }
      },
      () => {
        // Without a status, the wizard starts as usual.
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [transport]);
}
