import { cn } from 'cn';
import { CheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { BenchmarkProgress } from '../transport/generated/BenchmarkProgress';
import type { TaskRow } from '../transport/generated/TaskRow';
import { toTransportError } from '../transport/transport';
import { formatBytes } from './format';
import { addSample, timeLeft, transferRate, type Sample } from './transferRate';
import { useWizardStore } from './wizardStore';

/** A step's title, optional subtitle and body, with the footer pinned to the bottom of the panel. */
export function StepLayout({
  title,
  subtitle,
  left,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  /** The footer's left side: "set up later" unless given, nothing when `false`. */
  left?: ReactNode | false;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-6">
        <h2 className="mt-8 text-[1.375rem] font-medium">{title}</h2>
        {subtitle && <p className="mt-1.5 text-[0.8125rem] text-text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      <footer className="flex items-center gap-2 border-t border-hairline px-7 py-4">
        {left === undefined ? <LaterButton /> : left}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </footer>
    </>
  );
}

/** "Set up later" on a first run, "Cancel" on a re-run: both close the wizard for this run. */
export function LaterButton() {
  const { t } = useTranslation();
  const rerun = useWizardStore((s) => s.rerun);
  return (
    <Button
      variant="ghost"
      className="px-0 text-text-muted hover:bg-transparent hover:text-text"
      onClick={() => useWizardStore.getState().close()}
    >
      {rerun ? t('setup.cancel') : t('setup.later')}
    </Button>
  );
}

/** A radio list of hairline rows, no cards (interface design 1.4). */
export function ChoiceList({
  value,
  onChange,
  label,
  children,
}: {
  value: string | null;
  onChange(value: string): void;
  label: string;
  children: ReactNode;
}) {
  return (
    <RadioGroup
      value={value ?? ''}
      onValueChange={onChange}
      aria-label={label}
      className="grid-cols-1 gap-0 border-t border-hairline"
    >
      {children}
    </RadioGroup>
  );
}

export function ChoiceRow({
  value,
  disabled = false,
  showRadio = true,
  children,
}: {
  value: string;
  disabled?: boolean;
  /** The version and network tables mark the chosen row by its fill only, as in the mockups. */
  showRadio?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-3 border-b border-hairline px-3 py-3.5 text-[0.875rem]',
        'has-[[data-state=checked]]:bg-divider-soft',
        disabled ? 'cursor-default text-text-muted' : 'cursor-pointer',
      )}
    >
      <RadioGroupItem value={value} disabled={disabled} className={showRadio ? '' : 'sr-only'} />
      {children}
    </label>
  );
}

/** A spinner while a row is pending, then a tick. */
export function RowStatus({ done }: { done: boolean }) {
  const { t } = useTranslation();
  return done ? (
    <CheckIcon className="size-4 text-text-muted" role="img" aria-label={t('setup.detect.done')} />
  ) : (
    <LoaderCircleIcon
      className="size-4 animate-spin text-text-muted"
      role="status"
      aria-label={t('setup.detect.detecting')}
    />
  );
}

/** A failed list request, with its reason and a retry. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const { t } = useTranslation();
  const reason = t(`errors.${toTransportError(error).code}`);
  return (
    <div role="alert" className="flex items-center gap-3 py-3 text-[0.8125rem] text-engine-error">
      <span>{t('setup.loadFailed', { reason })}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('setup.retry')}
      </Button>
    </div>
  );
}

/** The install tasks, one row each, as the job snapshot reports them (mockup setup-5). */
export function TaskRows({
  tasks,
  benchmark = null,
}: {
  tasks: TaskRow[];
  /** The job's benchmark progress, shown under the benchmark row while it runs. */
  benchmark?: BenchmarkProgress | null;
}) {
  return (
    <ul className="border-t border-hairline">
      {tasks.map((row) => (
        <TaskRowView key={row.task} row={row} benchmark={benchmark} />
      ))}
    </ul>
  );
}

/**
 * What the benchmark is doing: starting KataGo and loading the network until the first count
 * begins, then the count under test, with a line for each count already measured.
 */
function BenchmarkLines({ progress }: { progress: BenchmarkProgress | null }) {
  const { t } = useTranslation();
  const tested = progress?.tested ?? [];
  const stage =
    progress?.testing != null
      ? t('setup.install.benchmark.testing', { threads: progress.testing })
      : tested.length > 0
        ? t('setup.install.benchmark.choosing')
        : t('setup.install.benchmark.starting');
  return (
    <div className="mt-1.5 ml-7 text-[0.75rem] text-text-muted tabular-nums">
      <p>{stage}</p>
      {tested.map((speed) => (
        <p key={speed.threads}>
          {t('setup.install.benchmark.result', {
            threads: speed.threads,
            speed: Math.round(speed.visitsPerSecond),
          })}
        </p>
      ))}
    </div>
  );
}

/** The rows whose `done` and `total` are bytes; the benchmark and the test query count steps. */
const DOWNLOADS = new Set<TaskRow['task']>(['engine', 'runtime', 'network']);

/**
 * "620 MB / 1000 MB" under a download's bar, then in brackets its speed and the time left once a
 * second of samples is in.
 */
function TransferLine({ done, total }: { done: number; total: number }) {
  const { t, i18n } = useTranslation();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [seen, setSeen] = useState<number | null>(null);
  // Each new count is a sample, taken while rendering the snapshot that brought it.
  if (done !== seen) {
    setSeen(done);
    setSamples((current) => addSample(current, { at: Date.now(), done }));
  }
  // Snapshots come only when bytes arrive, so a stalled download would keep its last speed.
  // Sampling each second lets the speed fall to nothing instead.
  useEffect(() => {
    const timer = setInterval(
      () => setSamples((current) => addSample(current, { at: Date.now(), done })),
      1000,
    );
    return () => clearInterval(timer);
  }, [done]);
  const rate = transferRate(samples);
  const bytes = (value: number) => formatBytes(value, i18n.language);
  const amount = { done: bytes(done), total: bytes(total) };
  let text = t('setup.install.amount', amount);
  if (rate !== null && rate > 0) {
    const left = timeLeft(Math.max(0, total - done) / rate);
    const remaining = t(`setup.install.timeLeft.${left.unit}`, left);
    text = t('setup.install.amountSpeedLeft', { ...amount, speed: bytes(rate), remaining });
  } else if (rate !== null) {
    text = t('setup.install.amountSpeed', { ...amount, speed: bytes(rate) });
  }
  return <p className="mt-1.5 ml-7 text-[0.75rem] text-text-muted tabular-nums">{text}</p>;
}

function TaskRowView({ row, benchmark }: { row: TaskRow; benchmark: BenchmarkProgress | null }) {
  const { t } = useTranslation();
  const label = t(`setup.install.tasks.${row.task}`);
  const state = row.state;
  const line = 'flex items-center gap-3 py-3.5 text-[0.875rem]';

  if (state.state === 'running') {
    const percent =
      state.total > 0 ? Math.min(100, Math.floor((state.done * 100) / state.total)) : null;
    return (
      <li className="border-b border-hairline pb-3">
        <div className={line}>
          <LoaderCircleIcon className="size-4 animate-spin text-text-muted" aria-hidden />
          <span className="font-medium">{label}</span>
          {percent !== null && (
            <span className="ml-auto font-medium tabular-nums">{`${percent}%`}</span>
          )}
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          className="ml-7 h-0.5 overflow-hidden rounded-full bg-hairline"
        >
          <div className="h-full bg-text" style={{ width: `${percent ?? 0}%` }} />
        </div>
        {DOWNLOADS.has(row.task) && <TransferLine done={state.done} total={state.total} />}
        {row.task === 'benchmark' && <BenchmarkLines progress={benchmark} />}
      </li>
    );
  }
  if (state.state === 'failed') {
    return (
      <li className={cn(line, 'border-b border-hairline text-engine-error')}>
        <XIcon className="size-4" aria-hidden />
        <span>{label}</span>
        <span className="ml-auto text-[0.8125rem] text-engine-error">
          {t('setup.install.failed')}
        </span>
      </li>
    );
  }
  if (state.state === 'done' || state.state === 'reused') {
    return (
      <li className={cn(line, 'border-b border-hairline')}>
        <CheckIcon className="size-4 text-text-muted" aria-hidden />
        <span>{label}</span>
        <span className="ml-auto text-[0.8125rem] text-text-muted">
          {t(state.state === 'done' ? 'setup.install.done' : 'setup.install.reused')}
        </span>
      </li>
    );
  }
  return (
    <li className={cn(line, 'border-b border-hairline text-text-muted')}>
      <span className="flex size-4 items-center justify-center" aria-hidden>
        <span className="size-1 rounded-full bg-text-muted" />
      </span>
      <span>{label}</span>
    </li>
  );
}
