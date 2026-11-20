import { create } from 'zustand';

/** What the panel body shows when neither the wizard nor a job holds it. */
export type PanelView = 'main' | 'settings' | 'about';

export const usePanelStore = create<{ view: PanelView; show(view: PanelView): void }>()((set) => ({
  view: 'main',
  show: (view) => set({ view }),
}));
