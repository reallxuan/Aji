import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useBenchmarkStore } from '../setup/benchmarkStore';
import { TaskRows } from '../setup/parts';
import { cancelInstall, startInstall } from '../transport/api';
import type { ActiveSummary } from '../transport/generated/ActiveSummary';
import { toTransportError } from '../transport/transport';
import { useTransport } from '../transport/TransportProvider';

/**
 * The search thread count, whether it was measured, and the benchmark on request: it runs on
 * the active set here, with its progress, and the engine restarts on the measured count.
 */
export function BenchmarkRow({
  active,
  disabled,
  onMeasured,
}: {
  active: ActiveSummary;
  /** No benchmark can start, as while the engine starts. */
  disabled: boolean;
  /** A benchmark finished: the summary is read again. */
  onMeasured(): void;
}) {
  const { t } = useTranslation();
  const transport = useTransport();
  const job = useBenchmarkStore((s) => s.job);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcome = job?.outcome ?? null;
  const running = job !== null && outcome === null;

  // A finished benchmark updates the line; a cancelled one is forgotten.
  useEffect(() => {
    if (outcome?.outcome === 'installed' || outcome?.outcome === 'cancelled') {
      useBenchmarkStore.getState().setJob(null);
      if (outcome.outcome === 'installed') onMeasured();
    }
  }, [outcome, onMeasured]);

  const measure = async () => {
    setError(null);
    setStarting(true);
    useBenchmarkStore.getState().setJob(null);
    try {
      await startInstall(transport, active.engine, active.network, [], { benchmark: true });
    } catch (failure) {
      setError(t(`errors.${toTransportError(failure).code}`));
    } finally {
      setStarting(false);
    }
  };

  const line =
    active.visitsPerSecond === null
      ? t('settings.threadsDefault', { threads: active.threads })
      : t('settings.threadsMeasured', {
          threads: active.threads,
          speed: Math.round(active.visitsPerSecond),
        });

  return (
    <div className="text-[0.8125rem]">
      <div className="flex items-center gap-3">
        <span className="flex-1 text-text-muted">{line}</span>
        {running ? (
          <Button variant="outline" size="sm" onClick={() => void cancelInstall(transport)}>
            {t('setup.cancel')}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || starting}
            onClick={() => void measure()}
          >
            {t('settings.benchmark')}
          </Button>
        )}
      </div>
      {running && (
        <div className="mt-2">
          <TaskRows
            tasks={job.tasks.filter((row) => row.task === 'benchmark' || row.task === 'testQuery')}
            benchmark={job.benchmark}
          />
        </div>
      )}
      {outcome?.outcome === 'failed' && (
        <p role="alert" className="mt-2 text-engine-error">
          {t('settings.benchmarkFailed', { reason: t(`setup.failure.${outcome.failure}`) })}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-engine-error">
          {error}
        </p>
      )}
    </div>
  );
}
