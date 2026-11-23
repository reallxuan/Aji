import type { TFunction } from 'i18next';
import type { ActionContext } from '../game/actions';
import { useNoticeStore } from '../game/noticeStore';
import { errorNotice } from '../game/notices';
import { clearCache, startJob, stopJob } from '../transport/api';
import type { CacheScope } from '../transport/generated/CacheScope';
import type { JobOptions } from '../transport/generated/JobOptions';
import { useJobPanelStore } from './jobPanelStore';

export const openJobPanel = () => useJobPanelStore.getState().setOpen(true);

const fail = (t: TFunction, title: string, error: unknown) =>
  useNoticeStore.getState().show(errorNotice(title, error, t));

export async function startGameJob(ctx: ActionContext, options: JobOptions): Promise<void> {
  try {
    await startJob(ctx.transport, options);
  } catch (error) {
    fail(ctx.t, ctx.t('notice.jobFailed'), error);
  }
}

export async function stopGameJob(ctx: ActionContext): Promise<void> {
  await stopJob(ctx.transport).catch(() => {});
}

/** 清除分析结果 ▸ 本局面 / 整局. */
export async function clearAnalysis(ctx: ActionContext, scope: CacheScope): Promise<void> {
  try {
    await clearCache(ctx.transport, scope);
  } catch (error) {
    fail(ctx.t, ctx.t('notice.clearFailed'), error);
  }
}
