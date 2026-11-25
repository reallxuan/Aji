import { create } from 'zustand';

/** Whether 添加引擎 (P2 M4 design 6.3) is open: the chip menu and Settings open it. */
export const useAddEngineStore = create<{ open: boolean; setOpen(open: boolean): void }>()(
  (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  }),
);
