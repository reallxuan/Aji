import { useEffect } from 'react';
import { useAddEngineStore } from '../engine/addEngineStore';
import { getInstallStatus } from '../transport/api';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import { useTransport } from '../transport/TransportProvider';
import { isBenchmarkJob, useBenchmarkStore } from './benchmarkStore';
import { useWizardStore } from './wizardStore';

/** A benchmark job goes to settings, 添加引擎's job to its dialog, any other job to the wizard. */
function route(job: JobSnapshot) {
  if (isBenchmarkJob(job)) useBenchmarkStore.getState().setJob(job);
  else if (!useAddEngineStore.getState().claim(job)) useWizardStore.getState().applyProgress(job);
}

/**
 * Follows install progress. On mount it asks for the current job, so a window reload during an
 * install, or after one failed, comes back to the install step (a benchmark job to settings); an
 * older finished or cancelled job is left alone. It subscribes first, so a snapshot pushed meanwhile wins over the status reply.
 */
export function useSetupProgress(): void {
  const transport = useTransport();

  useEffect(() => {
    let active = true;
    const unsubscribe = transport.subscribe((event) => {
      if (active && event.type === 'setupProgress') route(event.job);
    });
    getInstallStatus(transport).then(
      (job) => {
        if (!active || !job || useWizardStore.getState().job || useBenchmarkStore.getState().job) {
          return;
        }
        if (job.outcome === null || job.outcome.outcome === 'failed') route(job);
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
