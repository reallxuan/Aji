import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { detectHardware } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { formatBytes } from './format';
import { archLabel, mainGpu } from './labels';
import { LoadError, RowStatus, StepLayout } from './parts';
import { useWizardStore } from './wizardStore';

/** How long the ticks stay on screen before the wizard moves on by itself. */
export const DETECT_PAUSE_MS = 600;

/** Step 1: four rows that fill in as detection answers, then the backend step. */
export function StepDetect() {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const hardware = useWizardStore((s) => s.hardware);
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (hardware) {
      const timer = setTimeout(() => useWizardStore.getState().goTo('backend'), DETECT_PAUSE_MS);
      return () => clearTimeout(timer);
    }
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

  const gpu = mainGpu(hardware);
  const notFound = t('setup.detect.notFound');
  const bytes = (value: number) => formatBytes(value, i18n.language);
  const rows: Array<{ key: string; label: string; value: string | null }> = [
    { key: 'gpu', label: t('setup.detect.gpu'), value: hardware && (gpu?.name ?? notFound) },
    gpu?.memoryBytes != null || !hardware || gpu === null || gpu.vendor !== 'apple'
      ? {
          key: 'memory',
          label: t('setup.detect.gpuMemory'),
          value: hardware && (gpu?.memoryBytes != null ? bytes(gpu.memoryBytes) : notFound),
        }
      : // Apple GPUs share the system memory.
        { key: 'memory', label: t('setup.detect.memory'), value: bytes(hardware.memoryBytes) },
    {
      key: 'system',
      label: t('setup.detect.system'),
      value:
        hardware &&
        [t(`os.${hardware.os.kind}`), hardware.os.version, archLabel(hardware.os.arch)]
          .filter(Boolean)
          .join(' '),
    },
    {
      key: 'driver',
      label: t('setup.detect.driver'),
      value:
        hardware &&
        (gpu?.vendor === 'apple'
          ? t('setup.detect.driverBuiltIn')
          : (gpu?.driverVersion ?? notFound)),
    },
  ];

  return (
    <StepLayout title={t('setup.steps.detect')}>
      <ul className="border-t border-hairline">
        {rows.map(({ key, label, value }) => (
          <li
            key={key}
            className="flex items-center gap-4 border-b border-hairline py-4 text-[14px]"
          >
            <span className="w-16 shrink-0 text-[13px] text-text-muted">{label}</span>
            <span
              className={value === null || value === notFound ? 'flex-1 text-text-muted' : 'flex-1'}
            >
              {value ?? t('setup.detect.detecting')}
            </span>
            <RowStatus done={value !== null} />
          </li>
        ))}
      </ul>
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
