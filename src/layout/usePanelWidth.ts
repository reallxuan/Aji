import { createContext, useContext } from 'react';

/** The size of the panel a component sits in, as its panel measured it (P2 M1 design 5.4). */
export type PanelSize = { width: number; height: number };

export const PanelSizeContext = createContext<PanelSize>({ width: 0, height: 0 });

export function usePanelSize(): PanelSize {
  return useContext(PanelSizeContext);
}

/** The panel's inner width in CSS pixels; 0 outside a panel. */
export function usePanelWidth(): number {
  return usePanelSize().width;
}
