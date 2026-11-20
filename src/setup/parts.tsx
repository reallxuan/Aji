import { cn } from 'cn';
import { CheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { TaskRow } from '../transport/generated/TaskRow';
import { toTransportError } from '../transport/transport';
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
        <h2 className="mt-8 text-[22px] font-medium">{title}</h2>
        {subtitle && <p className="mt-1.5 text-[13px] text-text-muted">{subtitle}</p>}
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
      className="gap-0 border-t border-hairline"
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
        'flex items-center gap-3 border-b border-hairline px-3 py-3.5 text-[14px]',
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
    <div role="alert" className="flex items-center gap-3 py-3 text-[13px] text-engine-error">
      <span>{t('setup.loadFailed', { reason })}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('setup.retry')}
      </Button>
    </div>
  );
}

/** The install tasks, one row each, as the job snapshot reports them (mockup setup-5). */
export function TaskRows({ tasks }: { tasks: TaskRow[] }) {
  return (
    <ul className="border-t border-hairline">
      {tasks.map((row) => (
        <TaskRowView key={row.task} row={row} />
      ))}
    </ul>
  );
}

function TaskRowView({ row }: { row: TaskRow }) {
  const { t } = useTranslation();
  const label = t(`setup.install.tasks.${row.task}`);
  const state = row.state;
  const line = 'flex items-center gap-3 py-3.5 text-[14px]';

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
      </li>
    );
  }
  if (state.state === 'failed') {
    return (
      <li className={cn(line, 'border-b border-hairline text-engine-error')}>
        <XIcon className="size-4" aria-hidden />
        <span>{label}</span>
        <span className="ml-auto text-[13px] text-engine-error">{t('setup.install.failed')}</span>
      </li>
    );
  }
  if (state.state === 'done' || state.state === 'reused') {
    return (
      <li className={cn(line, 'border-b border-hairline')}>
        <CheckIcon className="size-4 text-text-muted" aria-hidden />
        <span>{label}</span>
        <span className="ml-auto text-[13px] text-text-muted">
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
