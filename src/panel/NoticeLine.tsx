import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNoticeStore } from '../game/noticeStore';

const MARK = '!';

const STYLE = {
  error: {
    band: 'bg-[color-mix(in_srgb,var(--engine-error)_7%,var(--panel))]',
    mark: 'bg-engine-error',
  },
  warning: {
    band: 'bg-[color-mix(in_srgb,var(--score)_8%,var(--panel))]',
    mark: 'bg-score',
  },
} as const;

/**
 * The panel's one notice line, under the header (design 5.8, mockup frame E). Errors stay until
 * closed or replaced; warnings fade after 6 s. It is announced, but never takes the focus.
 */
export function NoticeLine() {
  const { t } = useTranslation();
  const notice = useNoticeStore((s) => s.notice);
  const dismiss = useNoticeStore((s) => s.dismiss);
  if (!notice) return null;
  const style = STYLE[notice.kind];
  return (
    <div
      key={notice.id}
      data-notice={notice.kind}
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={`flex flex-none items-start gap-2.5 border-b border-hairline py-2.5 pr-[18px] pl-6 text-[13px] leading-normal ${style.band}`}
    >
      <span
        className={`mt-px flex size-4 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white ${style.mark}`}
        aria-hidden
      >
        {MARK}
      </span>
      <span className="min-w-0 flex-1 break-words">
        <b className="font-semibold">{notice.title}</b>
        {notice.detail && (
          <span className="block text-[12.5px] whitespace-pre-line text-text-muted">
            {notice.detail}
          </span>
        )}
      </span>
      <button
        type="button"
        className="-mr-1 flex size-5 flex-none items-center justify-center rounded-sm text-text-muted hover:bg-divider-soft hover:text-text"
        aria-label={t('notice.dismiss')}
        onClick={dismiss}
      >
        <XIcon className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
