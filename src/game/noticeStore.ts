import { create } from 'zustand';

/** The panel's one notice line (design 5.8). */
export interface Notice {
  kind: 'error' | 'warning';
  title: string;
  detail?: string;
  id: number;
}

/** Warnings fade after this long; errors stay until closed or replaced. */
export const WARNING_MS = 6000;

export interface NoticeState {
  notice: Notice | null;
  /** Replaces the notice shown. */
  show(notice: Omit<Notice, 'id'>): void;
  dismiss(): void;
}

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

export const useNoticeStore = create<NoticeState>()((set, get) => ({
  notice: null,
  show: (notice) => {
    const id = nextId++;
    clearTimeout(timer);
    set({ notice: { ...notice, id } });
    if (notice.kind === 'warning') {
      timer = setTimeout(() => {
        if (get().notice?.id === id) set({ notice: null });
      }, WARNING_MS);
    }
  },
  dismiss: () => {
    clearTimeout(timer);
    set({ notice: null });
  },
}));

/** No notice, no timer. For tests. */
export function resetNotices(): void {
  clearTimeout(timer);
  useNoticeStore.setState({ notice: null });
}
