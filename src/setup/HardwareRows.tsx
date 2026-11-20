import { useTranslation } from 'react-i18next';
import type { HardwareReport } from '../transport/generated/HardwareReport';
import { formatBytes } from './format';
import { archLabel, mainGpu } from './labels';
import { RowStatus } from './parts';

/**
 * What detection found, as four compact rows above the backend list: each shows a spinner until
 * the report arrives, then its value and a tick.
 */
export function HardwareRows({ hardware }: { hardware: HardwareReport | null }) {
  const { t, i18n } = useTranslation();
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
    <section aria-label={t('setup.detect.heading')}>
      <h3 className="text-[12px] text-text-muted">{t('setup.detect.heading')}</h3>
      <ul className="mt-1.5">
        {rows.map(({ key, label, value }) => (
          <li key={key} className="flex items-center gap-4 py-1.5 text-[13px]">
            <span className="w-24 shrink-0 whitespace-nowrap text-text-muted">{label}</span>
            <span
              className={
                value === null || value === notFound ? 'flex-1 text-text-muted' : 'flex-1 truncate'
              }
            >
              {value ?? t('setup.detect.detecting')}
            </span>
            <RowStatus done={value !== null} />
          </li>
        ))}
      </ul>
    </section>
  );
}
