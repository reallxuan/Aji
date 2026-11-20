import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cancelInstall } from '../transport/api';
import type { TaskRow } from '../transport/generated/TaskRow';
import { useTransport } from '../transport/TransportProvider';
import type { FallbackOffer } from '../transport/generated/FallbackOffer';
import type { FailedOutcome } from './failureActions';
import { FailurePanel } from './FailurePanel';
import { StepLayout, TaskRows } from './parts';
import { useWizardStore } from './wizardStore';

/** Shown between pressing install and the first snapshot, which names the real tasks. */
const PENDING: TaskRow[] = (
  ['engine', 'runtime', 'network', 'benchmark', 'testQuery'] as const
).map((task) => ({ task, state: { state: 'waiting' } }));

const toNetwork = () => useWizardStore.getState().backTo('network');

/** A declined licence is shown as panel A2 for `licenceNotAccepted`, though no job ran. */
const declinedOutcome = (offer: FallbackOffer | null): FailedOutcome => ({
  outcome: 'failed',
  failure: 'licenceNotAccepted',
  stderrTail: [],
  offer,
  driver: null,
});

/** Step 5: install progress, then the cancelled state or a failure panel. */
export function StepInstall() {
  const { t } = useTranslation();
  const transport = useTransport();
  const job = useWizardStore((s) => s.job);
  const backend = useWizardStore((s) => s.backend);
  const declined = useWizardStore((s) => s.declined);
  const startError = useWizardStore((s) => s.startError);
  const [cancelling, setCancelling] = useState(false);

  const retry = () => void useWizardStore.getState().retry(transport);
  const retryActions = (
    <>
      <Button variant="outline" onClick={toNetwork}>
        {t('setup.install.back')}
      </Button>
      <Button onClick={retry}>{t('setup.retry')}</Button>
    </>
  );

  if (declined && backend) {
    return <FailurePanel backend={backend} outcome={declinedOutcome(declined.offer)} tasks={[]} />;
  }
  if (job?.outcome?.outcome === 'failed') {
    return <FailurePanel backend={job.backend} outcome={job.outcome} tasks={job.tasks} />;
  }
  if (job?.outcome?.outcome === 'cancelled') {
    return (
      <StepLayout title={t('setup.install.cancelled')} actions={retryActions}>
        <TaskRows tasks={job.tasks} />
      </StepLayout>
    );
  }
  if (startError) {
    return (
      <StepLayout title={t('setup.install.notFinished')} actions={retryActions}>
        <p role="alert" className="text-[14px] text-engine-error">
          {t('setup.install.startFailed', { reason: t(`errors.${startError.code}`) })}
        </p>
      </StepLayout>
    );
  }

  const cancel = async () => {
    setCancelling(true);
    try {
      await cancelInstall(transport);
    } catch {
      // The job's own outcome reports what happened.
    } finally {
      setCancelling(false);
    }
  };

  // While a job runs, Cancel is the only way out, so no job is ever left running unseen.
  return (
    <StepLayout
      title={t('setup.steps.install')}
      left={false}
      actions={
        <Button variant="outline" disabled={cancelling || !job} onClick={() => void cancel()}>
          {t('setup.cancel')}
        </Button>
      }
    >
      <TaskRows tasks={job?.tasks ?? PENDING} />
    </StepLayout>
  );
}
