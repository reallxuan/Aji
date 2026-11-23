import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useActionContext } from '../game/useActionContext';
import { stopGameJob } from '../job/actions';
import { useJobStore } from '../job/jobStore';

/**
 * The whole-game job's status in the trend legend, after 目差 (P2 M2 design 5.3, mockup sections
 * 3–5): its count and time left, 先算当前局面 while the board goes first, 已暂停, the boost pass,
 * and 已分析全局 or 已停止 for a few seconds at the end. ✕ stops a job that still runs.
 */
export function JobStatus() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const progress = useJobStore((s) => s.progress);
  if (!progress) return null;

  const eta = progress.etaSeconds;
  const time =
    eta === null
      ? null
      : eta < 60
        ? t('job.status.underMinute')
        : t('job.status.minutes', { count: Math.ceil(eta / 60) });
  const count = { done: progress.done, total: progress.total };
  const muted = (text: string | null) => text && <span className="text-text-muted">{text}</span>;

  let parts: ReactNode[];
  switch (progress.state) {
    case 'running':
      parts = [t('job.status.running', count), muted(time)];
      break;
    case 'waiting':
      parts = [t('job.status.running', count), muted(t('job.status.waiting'))];
      break;
    case 'paused':
      parts = [muted(t('job.status.paused')), t('job.status.count', count)];
      break;
    case 'boosting':
      parts = [
        t('job.status.boosting', { done: progress.boostDone, total: progress.boostTotal }),
        muted(time),
      ];
      break;
    case 'done':
      parts = [t('job.status.done')];
      break;
    case 'stopped':
      parts = [muted(t('job.status.stopped'))];
      break;
  }
  const live = progress.state !== 'done' && progress.state !== 'stopped';

  return (
    <span
      data-testid="job-status"
      className="inline-flex items-center gap-2 whitespace-nowrap text-text tabular-nums"
    >
      {parts.filter(Boolean).map((part, i) => (
        // A space keeps the text readable as one line; the gap does the spacing.
        <span key={i}>
          {i > 0 && ' '}
          {part}
        </span>
      ))}
      {live && (
        <button
          type="button"
          aria-label={t('job.status.stop')}
          title={t('job.status.stop')}
          className="-m-1 rounded p-1 text-text-muted hover:text-text"
          onClick={() => void stopGameJob(ctx)}
        >
          <XIcon className="size-2.5" strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}
