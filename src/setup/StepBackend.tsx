import { ArrowUpRightIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { openExternal } from '../platform/openExternal';
import { detectHardware, getBackends } from '../transport/api';
import type { Backend } from '../transport/generated/Backend';
import { useTransport } from '../transport/TransportProvider';
import { HardwareRows } from './HardwareRows';
import { backendName, tagText } from './labels';
import { ChoiceList, ChoiceRow, LoadError, StepLayout } from './parts';
import { useWizardStore } from './wizardStore';

/** NVIDIA's driver download page; it picks the region itself. */
export const NVIDIA_DRIVER_URL = 'https://www.nvidia.com/drivers/';

const toVersion = () => useWizardStore.getState().goTo('version');

/**
 * Step 1: what detection found, then the recommended backends, best first, with driver advice
 * when CUDA is held back. The backends are asked for once detection has answered.
 */
export function StepBackend() {
  const { t } = useTranslation();
  const transport = useTransport();
  const hardware = useWizardStore((s) => s.hardware);
  const recommendation = useWizardStore((s) => s.recommendation);
  const backend = useWizardStore((s) => s.backend);
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (hardware) return;
    let active = true;
    detectHardware(transport, false).then(
      (report) => {
        if (active) useWizardStore.getState().setHardware(report);
      },
      (error) => {
        if (active) setFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, [transport, hardware, attempt]);

  useEffect(() => {
    if (!hardware || recommendation) return;
    let active = true;
    getBackends(transport).then(
      (result) => {
        if (active) useWizardStore.getState().setRecommendation(result);
      },
      (error) => {
        if (active) setFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, [transport, hardware, recommendation, attempt]);

  /** Detects again, for a user who has just updated the driver. */
  const detectAgain = async () => {
    setDetecting(true);
    setFailure(null);
    try {
      const store = useWizardStore.getState();
      store.setHardware(await detectHardware(transport, true));
      store.setRecommendation(await getBackends(transport));
    } catch (error) {
      setFailure(error);
    } finally {
      setDetecting(false);
    }
  };

  const driver = recommendation?.driver ?? null;
  const rows: Array<{ backend: Backend; tags: string; disabled: boolean }> = [];
  if (driver && !recommendation?.backends.some((b) => b.backend === 'cuda')) {
    rows.push({ backend: 'cuda', tags: t('setup.backend.tags.needsDriver'), disabled: true });
  }
  for (const choice of recommendation?.backends ?? []) {
    rows.push({ backend: choice.backend, tags: tagText(t, choice.tags), disabled: false });
  }
  const unsupported = recommendation !== null && recommendation.backends.length === 0;

  return (
    <StepLayout
      title={t('setup.steps.backend')}
      actions={
        <Button disabled={!backend || unsupported} onClick={toVersion}>
          {t('setup.next')}
        </Button>
      }
    >
      <HardwareRows hardware={hardware} />
      {unsupported && (
        <p className="mt-6 text-[0.875rem] text-text-muted">{t('setup.backend.unsupported')}</p>
      )}
      {rows.length > 0 && (
        <div className="mt-6">
          <ChoiceList
            value={backend}
            onChange={(value) => useWizardStore.getState().chooseBackend(value as Backend)}
            label={t('setup.steps.backend')}
          >
            {rows.map((row) => (
              <ChoiceRow key={row.backend} value={row.backend} disabled={row.disabled}>
                <span className="flex-1 font-medium">{backendName(t, row.backend)}</span>
                <span className="text-[0.8125rem] text-text-muted">{row.tags}</span>
              </ChoiceRow>
            ))}
          </ChoiceList>
        </div>
      )}
      {driver && (
        <div className="mt-4 text-[0.8125rem] text-text-muted">
          <p>
            {driver.current
              ? t('setup.backend.driverAdvice', {
                  current: driver.current,
                  required: driver.required,
                })
              : t('setup.backend.driverUnknown', { required: driver.required })}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <Button
              variant="link"
              className="h-auto px-0 text-text"
              onClick={() => void openExternal(NVIDIA_DRIVER_URL).catch(() => undefined)}
            >
              {t('setup.backend.downloadDriver')}
              <ArrowUpRightIcon aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={detecting}
              onClick={() => void detectAgain()}
            >
              {t('setup.backend.detectAgain')}
            </Button>
          </div>
        </div>
      )}
      {failure !== null && (
        <LoadError
          error={failure}
          onRetry={() => {
            setFailure(null);
            setAttempt((n) => n + 1);
          }}
        />
      )}
    </StepLayout>
  );
}
