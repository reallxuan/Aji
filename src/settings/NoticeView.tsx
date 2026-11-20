import { ArrowLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** A licence text, shown in the panel with a way back. The text ships inside Aji. */
export function NoticeView({
  title,
  text,
  onBack,
}: {
  title: string;
  /** `null` while a large text is still loading. */
  text: string | null;
  onBack(): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelTitle title={title} onBack={onBack} backLabel={t('settings.back')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {text === null ? (
          <p className="text-[13px] text-text-muted">{t('about.loading')}</p>
        ) : (
          <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-muted">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}

/** "← Title", the header of every secondary panel page. */
export function PanelTitle({
  title,
  onBack,
  backLabel,
}: {
  title: string;
  onBack(): void;
  backLabel: string;
}) {
  return (
    <header className="flex items-center gap-2 px-6 py-4">
      <button
        type="button"
        aria-label={backLabel}
        className="flex size-7 items-center justify-center rounded-sm text-text-muted hover:text-text"
        onClick={onBack}
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
      </button>
      <h2 className="min-w-0 truncate text-[16px] font-medium">{title}</h2>
    </header>
  );
}
