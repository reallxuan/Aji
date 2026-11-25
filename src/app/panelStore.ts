import { create } from 'zustand';

/** What the panel body shows when neither the wizard nor a job holds it. */
export type PanelView = 'main' | 'settings' | 'about';

/** A Settings section to scroll to when Settings opens (管理引擎…, P2 M4 design 6.2). */
export type PanelSection = 'engine';

export const usePanelStore = create<{
  view: PanelView;
  section: PanelSection | null;
  show(view: PanelView, section?: PanelSection): void;
}>()((set) => ({
  view: 'main',
  section: null,
  show: (view, section) => set({ view, section: section ?? null }),
}));
