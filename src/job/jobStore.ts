import { create } from 'zustand';
import type { JobProgress } from '../transport/generated/JobProgress';

/** How long a finished or stopped job's status stays. */
export const ENDED_MS = 4000;

export interface JobState {
  /** The whole-game job's latest progress; `null` when none runs or has just ended. */
  progress: JobProgress | null;
  /** When an ended job's status goes away, in `Date.now()` time; `null` while one runs. */
  doneUntil: number | null;
  /**
   * Whether the coverage strip shows under the graph: from a job's start until the game is closed
   * (P2 M2 design 5.3), so it outlives the job's status.
   */
  strip: boolean;
  apply(progress: JobProgress): void;
  /** Another game, or every result gone: the strip has nothing left to show. */
  hideStrip(): void;
}

const initial = {
  progress: null as JobProgress | null,
  doneUntil: null as number | null,
  strip: false,
};
let clearing: ReturnType<typeof setTimeout> | null = null;

const ended = (p: JobProgress) => p.state === 'done' || p.state === 'stopped';

export const useJobStore = create<JobState>()((set) => ({
  ...initial,
  apply: (progress) => {
    if (clearing) clearTimeout(clearing);
    clearing = null;
    if (!ended(progress)) {
      set({ progress, doneUntil: null, strip: true });
      return;
    }
    // An ended status never shows the strip: a late one may be the closed game's.
    set({ progress, doneUntil: Date.now() + ENDED_MS });
    clearing = setTimeout(() => {
      clearing = null;
      set({ progress: null, doneUntil: null });
    }, ENDED_MS);
  },
  hideStrip: () => set({ strip: false }),
}));

/** Whether a job is searching: it holds the engine's pause, even at the board's visit limit. */
export function jobActive(progress: JobProgress | null): boolean {
  return (
    progress?.state === 'running' || progress?.state === 'waiting' || progress?.state === 'boosting'
  );
}

/** Back to no job. For tests. */
export function resetJobStore(): void {
  if (clearing) clearTimeout(clearing);
  clearing = null;
  useJobStore.setState(initial);
}
