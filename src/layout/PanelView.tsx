import { cn } from 'cn';
import { type PointerEvent, useRef, useState } from 'react';
import { Grip } from './Grip';
import type { Resize } from './Hairline';
import { type PanelRef, refId, sameRef } from './model';
import { panelSpec } from './registry';
import { useElementSize } from './useElementSize';
import { PanelSizeContext } from './usePanelWidth';

/** What the panels and hairlines can do to the layout drawn now. */
export type Actions = {
  coarse: boolean;
  dragging: PanelRef | null;
  startDrag(ref: PanelRef, e: PointerEvent): void;
  selectTab(ref: PanelRef): void;
  beginResize(path: number[], first: number, second: number, mins: [number, number]): () => Resize;
  even(path: number[], first: number, second: number): void;
};

export const STILL: Actions = {
  coarse: false,
  dragging: null,
  startDrag: () => {},
  selectTab: () => {},
  beginResize: () => () => ({ move: () => {}, cancel: () => {} }),
  even: () => {},
};

/** One panel: measured, so what it holds can size itself to it, with its grip at the top left. */
export function PanelView({ panel, actions = STILL }: { panel: PanelRef; actions?: Actions }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const [hovered, setHovered] = useState(false);
  const { Component } = panelSpec(panel.kind);
  const dragged = actions.dragging !== null && sameRef(actions.dragging, panel);
  return (
    <div
      ref={ref}
      data-panel={refId(panel)}
      data-max-rows={panel.maxRows}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        dragged && 'opacity-40',
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {actions !== STILL && (hovered || actions.coarse || dragged) && (
        <Grip
          panel={panel}
          coarse={actions.coarse}
          onPointerDown={(e) => actions.startDrag(panel, e)}
        />
      )}
      <PanelSizeContext.Provider value={size}>
        <Component panel={panel} width={size.width} height={size.height} />
      </PanelSizeContext.Provider>
    </div>
  );
}
