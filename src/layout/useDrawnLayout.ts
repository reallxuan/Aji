import { SIDE_MIN_WIDTH } from './constants';
import { layoutFrame } from './frameGeometry';
import type { Layout, PanelRef } from './model';
import { panelMinSize } from './registry';
import { useLayout } from './useLayout';
import { useWindowSize } from './useWindowSize';

/** Panels' minimum sizes; while the wizard or settings fill the header's column, it is wider. */
export function frameMinSize(sideOpen: boolean) {
  return (ref: PanelRef) => {
    const base = panelMinSize(ref);
    return sideOpen && ref.kind === 'header'
      ? { ...base, width: Math.max(base.width, SIDE_MIN_WIDTH) }
      : base;
  };
}

/**
 * The layout as the frame draws it in this window: the untouched default may be in its wide
 * form. Changes made from a menu start from it, as a drag does, so what was drawn is what changes.
 */
export function useDrawnLayout(sideOpen: boolean): {
  drawn: Layout;
  setLayout(next: Layout): void;
} {
  const { width, height } = useWindowSize();
  const { layout, setLayout } = useLayout();
  return { drawn: layoutFrame(layout, width, height, frameMinSize(sideOpen)).layout, setLayout };
}
