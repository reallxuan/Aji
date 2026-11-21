import { computeFrame } from './frame';
import { useWindowSize } from './useWindowSize';

/** The panel's inner width in CSS pixels, from the window's size (less its 1 px left border). */
export function usePanelWidth(): number {
  const { width, height } = useWindowSize();
  return Math.max(0, computeFrame(width, height).panel.width - 1);
}
