import { create } from 'zustand';

/** Whether 分析全局… is open, below the game title. Menus and keys open it. */
export const useJobPanelStore = create<{ open: boolean; setOpen(open: boolean): void }>()(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);
