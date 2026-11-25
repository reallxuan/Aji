import { create } from 'zustand';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';

/** The set the dialog asked to install, so its progress shows there rather than in the wizard. */
export interface AddTarget {
  engine: string;
  network: string;
}

interface AddEngineState {
  /** Whether 添加引擎 (P2 M4 design 6.3) is open: the chip menu and Settings open it. */
  open: boolean;
  target: AddTarget | null;
  /** The target's install job, from its first progress on. */
  job: JobSnapshot | null;
  setOpen(open: boolean): void;
  setTarget(target: AddTarget | null): void;
  /** Takes `job` when it installs the target; `false` leaves it to the wizard. */
  claim(job: JobSnapshot): boolean;
}

const initial = { open: false, target: null as AddTarget | null, job: null as JobSnapshot | null };

export const useAddEngineStore = create<AddEngineState>()((set, get) => ({
  ...initial,
  // Closed mid-install, the job keeps its target: reopening shows its progress again.
  setOpen: (open) => {
    const { target, job } = get();
    const installing = target !== null && (job === null || job.outcome === null);
    set(open || installing ? { open } : initial);
  },
  setTarget: (target) => set({ target, job: null }),
  claim: (job) => {
    const { target } = get();
    if (!target || job.measures || job.engine !== target.engine || job.network !== target.network)
      return false;
    set({ job });
    return true;
  },
}));

/** Closed, with nothing installing. For tests. */
export function resetAddEngineStore(): void {
  useAddEngineStore.setState(initial);
}
