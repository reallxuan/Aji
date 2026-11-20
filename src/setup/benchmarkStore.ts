import { create } from 'zustand';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';

/**
 * A job that measures the thread count. Only settings starts one (the wizard installs without
 * the benchmark), and it is shown there, never in the wizard.
 */
export function isBenchmarkJob(job: JobSnapshot): boolean {
  return job.measures;
}

/** The benchmark job settings started, or the last one, until settings clears it. */
export const useBenchmarkStore = create<{
  job: JobSnapshot | null;
  setJob(job: JobSnapshot | null): void;
}>()((set) => ({
  job: null,
  setJob: (job) => set({ job }),
}));
