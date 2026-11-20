import { cn } from 'cn';
import { CheckIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toTransportError } from '../transport/transport';
import { useWizardStore } from './wizardStore';

/** A step's title, optional subtitle and body, with the footer pinned to the bottom of the panel. */
export function StepLayout({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
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
        <LaterButton />
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </footer>
    </>
  );
}

/** "Set up later" on a first run, "Cancel" on a re-run: both close the wizard for this run. */
function LaterButton() {
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
