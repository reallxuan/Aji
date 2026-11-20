import { ArrowUpRightIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { openExternal } from '../platform/openExternal';
import type { Backend } from '../transport/generated/Backend';
import type { TaskRow } from '../transport/generated/TaskRow';
import { useTransport } from '../transport/TransportProvider';
import { failureActions, type FailedOutcome, type FailureAction } from './failureActions';
import { formatBytes } from './format';
import { backendName } from './labels';
import { StepLayout, TaskRows } from './parts';
import { NVIDIA_DRIVER_URL } from './StepBackend';
import { useWizardStore } from './wizardStore';

const toBackends = () => useWizardStore.getState().backTo('backend');
const toNetwork = () => useWizardStore.getState().backTo('network');

/** Panels A1, A2 and B of M5 design 5.3: what failed, why, and the ways on. */
export function FailurePanel({
  backend,
  outcome,
  tasks,
}: {
  backend: Backend;
  outcome: FailedOutcome;
  tasks: TaskRow[];
}) {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const { primary, secondary } = failureActions(outcome);
  const { offer, driver } = outcome;
  const offerSize =
    offer && formatBytes(offer.downloadBytes + (offer.runtimeBytes ?? 0), i18n.language);
  const offerName = offer && backendName(t, offer.backend);
  // A names the backend; B, with nothing to switch to, says the install did not finish.
  const aboutBackend =
    offer !== null ||
    outcome.failure === 'gpuDriverTooOld' ||
    outcome.failure === 'licenceNotAccepted';

  const button = (action: FailureAction, main: boolean) => {
    const variant = main ? 'default' : 'outline';
    if (action === 'retry') {
      return (
        <Button
          key="retry"
          variant={variant}
          onClick={() => void useWizardStore.getState().retry(transport)}
        >
          {t('setup.retry')}
        </Button>
      );
    }
    if (action === 'fallback' && offer) {
      return (
        <Button
          key="fallback"
          variant={variant}
          onClick={() => useWizardStore.getState().adoptOffer(offer)}
        >
          {t('setup.install.switchTo', { backend: offerName, size: offerSize })}
        </Button>
      );
    }
    return (
      <Button key="back" variant={variant} onClick={toNetwork}>
        {t('setup.install.back')}
      </Button>
    );
  };

  return (
    <StepLayout
      title={
        aboutBackend
          ? t('setup.install.backendFailed', { backend: backendName(t, backend) })
          : t('setup.install.notFinished')
      }
      left={
        offer ? (
          <Button
            variant="ghost"
            className="px-0 text-text-muted hover:bg-transparent hover:text-text"
            onClick={toBackends}
          >
            {t('setup.install.backToBackends')}
          </Button>
        ) : undefined
      }
      actions={
        <>
          {secondary && button(secondary, false)}
          {button(primary, true)}
        </>
      }
    >
      {tasks.length > 0 && <TaskRows tasks={tasks} />}
      <div className="mt-5 space-y-3 text-[14px]">
        <p>{t(`setup.failure.${outcome.failure}`)}</p>
        {driver && (
          <div className="space-y-2 text-[13px] text-text-muted">
            <p>
              {driver.current
                ? t('setup.install.driver', { current: driver.current, required: driver.required })
                : t('setup.install.driverUnknown', { required: driver.required })}
            </p>
            <Button
              variant="link"
              className="h-auto px-0 text-text"
              onClick={() => void openExternal(NVIDIA_DRIVER_URL).catch(() => undefined)}
            >
              {t('setup.install.downloadDriver')}
              <ArrowUpRightIcon aria-hidden />
            </Button>
            <p>{t('setup.install.retryReuses')}</p>
          </div>
        )}
        {offer && primary === 'fallback' && (
          <p className="text-[13px] text-text-muted">
            {t('setup.install.offer', { backend: offerName, size: offerSize })}
          </p>
        )}
      </div>
      {outcome.stderrTail.length > 0 && (
        <Collapsible className="mt-5">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="group px-0 text-[13px] text-text-muted hover:bg-transparent hover:text-text"
            >
              <ChevronRightIcon
                className="transition-transform group-data-[state=open]:rotate-90"
                aria-hidden
              />
              {t('setup.install.lastOutput')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 overflow-x-auto rounded-sm bg-ground p-3 font-mono text-[12px] whitespace-pre-wrap text-text-muted">
              {outcome.stderrTail.join('\n')}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </StepLayout>
  );
}
