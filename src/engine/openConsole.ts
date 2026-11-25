import { create } from 'zustand';
import { panelsOf, type PanelRef, sameRef } from '../layout/model';
import { selectTab, showPanel } from '../layout/ops';
import { currentLayout, setLayout } from '../layout/useLayout';

/** The narrow arrangement's console sheet (P2 M4 design 6.5). */
export const useConsoleSheet = create<{
  open: boolean;
  /** The narrow arrangement is showing, so the console opens as a sheet. */
  narrow: boolean;
  setOpen(open: boolean): void;
}>()((set) => ({
  open: false,
  narrow: false,
  setOpen: (open) => set({ open }),
}));

const CONSOLE: PanelRef = { kind: 'console' };

/**
 * 引擎控制台: in a wide window the console panel joins the layout at the bottom of the header's
 * column, or comes to the front of its tab group; in the narrow arrangement it opens as a sheet.
 */
export function openConsole(): void {
  if (useConsoleSheet.getState().narrow) {
    useConsoleSheet.getState().setOpen(true);
    return;
  }
  const layout = currentLayout();
  const shown = panelsOf(layout.root).some((p) => sameRef(p, CONSOLE));
  setLayout(shown ? selectTab(layout, CONSOLE) : showPanel(layout, CONSOLE));
}
