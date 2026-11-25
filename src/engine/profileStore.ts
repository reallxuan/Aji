import { useEffect } from 'react';
import { create } from 'zustand';
import { useEstimateStore } from '../analysis/estimateStore';
import type { ActionContext } from '../game/actions';
import { useNoticeStore } from '../game/noticeStore';
import { errorNotice } from '../game/notices';
import { jobActive, useJobStore } from '../job/jobStore';
import { getProfiles, switchProfile } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import type { Transport } from '../transport/transport';

/** The engine profiles (P2 M4 design 6.1), as the backend last listed them. */
export interface ProfileState {
  profiles: ProfileSummary[];
  /** `devEngine` in settings.json decides what runs. */
  devOverride: boolean;
  load(transport: Transport): Promise<void>;
}

const initial = { profiles: [] as ProfileSummary[], devOverride: false };

export const useProfileStore = create<ProfileState>()((set) => ({
  ...initial,
  load: async (transport) => {
    try {
      set(await getProfiles(transport));
    } catch {
      // An older backend, or none yet: the list stays as it was.
    }
  },
}));

/** A switch waiting on the design 6.2 question, asked while a whole-game job runs. */
export interface PendingSwitch {
  id: string;
  name: string;
  done: number;
  total: number;
}

interface SwitchQuestion {
  pending: PendingSwitch | null;
  /** Switches on `true`; either way the question closes. */
  answer(yes: boolean): Promise<void>;
}

let confirm: (() => Promise<void>) | null = null;

export const useSwitchQuestion = create<SwitchQuestion>()((set) => ({
  pending: null,
  answer: async (yes) => {
    const run = confirm;
    confirm = null;
    set({ pending: null });
    if (yes && run) await run();
  },
}));

/** No profiles and no question. For tests. */
export function resetProfileStore(): void {
  useProfileStore.setState(initial);
  useSwitchQuestion.setState({ pending: null });
  confirm = null;
}

async function switchNow(ctx: ActionContext, id: string): Promise<void> {
  try {
    await switchProfile(ctx.transport, id);
  } catch (error) {
    useNoticeStore.getState().show(errorNotice(ctx.t('notice.switchFailed'), error, ctx.t));
    return;
  } finally {
    await useProfileStore.getState().load(ctx.transport);
  }
  // The trend comes back reset from the backend; the estimate is counted again from the new
  // network's ownership, so no count from the old one stays (design 6.2).
  useEstimateStore.getState().setScore(null);
}

/**
 * Switches to the profile `id`. While a whole-game job runs it asks first, since the switch
 * stops the job (design 6.2). For the chip, the settings list and the commands.
 */
export async function switchProfileAsking(ctx: ActionContext, id: string): Promise<void> {
  // The chip's menu reports a choice of the checked entry too: that one already runs.
  if (useProfileStore.getState().profiles.find((p) => p.id === id)?.current) return;
  const progress = useJobStore.getState().progress;
  if (progress && jobActive(progress)) {
    const name = useProfileStore.getState().profiles.find((p) => p.id === id)?.name ?? id;
    confirm = () => switchNow(ctx, id);
    useSwitchQuestion.setState({
      pending: { id, name, done: progress.done, total: progress.total },
    });
    return;
  }
  await switchNow(ctx, id);
}

/** The next (`1`) or previous (`-1`) profile in the list, wrapping around. */
export async function stepProfile(ctx: ActionContext, by: 1 | -1): Promise<void> {
  const { profiles, devOverride } = useProfileStore.getState();
  if (devOverride || profiles.length < 2) return;
  const at = profiles.findIndex((p) => p.current);
  const next = profiles[(at + by + profiles.length) % profiles.length];
  await switchProfileAsking(ctx, next.id);
}

/** Loads the profiles on start, and again when an install job ends (it may add one). */
export function useProfileSync(): void {
  const transport = useTransport();
  useEffect(() => {
    void useProfileStore.getState().load(transport);
    return transport.subscribe((event) => {
      if (event.type === 'setupProgress' && event.job.outcome !== null)
        void useProfileStore.getState().load(transport);
    });
  }, [transport]);
}
