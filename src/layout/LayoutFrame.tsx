import { cn } from 'cn';
import { type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TabRow } from '../panel/TabRow';
import { FIXED_HEIGHT, HAIRLINE_HIT, HAIRLINE_HIT_COARSE } from './constants';
import { type Frame, layoutFrame, minWidth } from './frameGeometry';
import { Grip } from './Grip';
import { Hairline, type Resize } from './Hairline';
import { MainBoard } from './MainBoard';
import { type Node, type PanelRef, panelsOf, refId, sameRef } from './model';
import { evenSplit, movePanel, resize, selectTab } from './ops';
import { panelLabelKey, panelMinSize, panelSpec } from './registry';
import { useCoarsePointer } from './useCoarsePointer';
import { useDragPanel } from './useDragPanel';
import { frameMinSize } from './useDrawnLayout';
import { useElementSize } from './useElementSize';
import { layoutCheckpoint, useLayout } from './useLayout';
import { PanelSizeContext } from './usePanelWidth';
import { useWindowSize } from './useWindowSize';

/** What the panels and hairlines can do to the layout drawn now. */
type Actions = {
  coarse: boolean;
  dragging: PanelRef | null;
  startDrag(ref: PanelRef, e: PointerEvent): void;
  selectTab(ref: PanelRef): void;
  beginResize(path: number[], index: number, mins: [number, number]): () => Resize;
  even(path: number[], index: number): void;
};

const STILL: Actions = {
  coarse: false,
  dragging: null,
  startDrag: () => {},
  selectTab: () => {},
  beginResize: () => () => ({ move: () => {}, cancel: () => {} }),
  even: () => {},
};

/** One panel: measured, so what it holds can size itself to it, with its grip at the top left. */
function PanelView({ panel, actions }: { panel: PanelRef; actions: Actions }) {
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
      {(hovered || actions.coarse || dragged) && (
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

const fixedHeight = (node: Node) => node.type === 'panel' && FIXED_HEIGHT.has(node.panel.kind);

function NodeView({
  node,
  path,
  actions,
}: {
  node: Node;
  path: number[];
  actions: Actions;
}): ReactNode {
  switch (node.type) {
    case 'board':
      return null;
    case 'panel':
      return <PanelView panel={node.panel} actions={actions} />;
    case 'tabs':
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabRow panels={node.panels} active={node.active} onSelect={actions.selectTab} />
          <PanelView panel={node.panels[node.active]} actions={actions} />
        </div>
      );
    case 'split': {
      const column = node.dir === 'column';
      return (
        <div className={cn('flex min-h-0 min-w-0 flex-1', column ? 'flex-col' : 'flex-row')}>
          {node.children.map((child, i) => {
            const prev = node.children[i - 1];
            // A line beside a panel of fixed height would have nothing to move.
            const resizable = i > 0 && !(column && (fixedHeight(prev) || fixedHeight(child)));
            const mins: [number, number] = column
              ? [minHeightOf(prev) ?? 0, minHeightOf(child) ?? 0]
              : [minWidth(prev ?? child, panelMinSize), minWidth(child, panelMinSize)];
            return (
              <div
                key={child.type === 'panel' ? refId(child.panel) : i}
                className={cn(
                  'relative flex min-h-0 min-w-0',
                  i > 0 && (column ? 'border-t border-hairline' : 'border-l border-hairline'),
                )}
                style={
                  column && fixedHeight(child)
                    ? { flex: '0 0 auto' }
                    : {
                        flex: `${node.weights[i] * 1000} 1 0`,
                        minHeight: column ? minHeightOf(child) : undefined,
                      }
                }
              >
                {resizable && (
                  <Hairline
                    dir={node.dir}
                    coarse={actions.coarse}
                    begin={actions.beginResize(path, i - 1, mins)}
                    onEven={() => actions.even(path, i - 1)}
                  />
                )}
                <NodeView node={child} path={[...path, i]} actions={actions} />
              </div>
            );
          })}
        </div>
      );
    }
  }
}

function minHeightOf(node: Node | undefined): number | undefined {
  if (node?.type === 'panel') return panelMinSize(node.panel).height;
  if (node?.type === 'tabs') return Math.max(...node.panels.map((p) => panelMinSize(p).height));
  return undefined;
}

/** Until the narrow arrangement (M1 Task 8), a narrow window stacks the board over the panels. */
function NarrowStack({
  frame,
  overlay,
  side,
}: {
  frame: Frame;
  overlay?: ReactNode;
  side?: ReactNode;
}) {
  const { width, height } = useWindowSize();
  const size = Math.max(0, Math.min(width, height) - 8);
  const columns = frame.layout.root.children.filter((c) => c.type !== 'board');
  return (
    <div className="relative h-full w-full overflow-y-auto">
      <div className="relative" style={{ height: size + 8 }}>
        <MainBoard rect={{ x: 4, y: 4, width: size, height: size }} overlay={overlay} />
      </div>
      <div className="flex flex-col bg-panel">
        {side ??
          columns.map((node, i) => (
            <div key={i} className="flex min-h-[480px]">
              <NodeView node={node} path={[i]} actions={STILL} />
            </div>
          ))}
      </div>
    </div>
  );
}

/**
 * The screen drawn from the device's layout (P2 M1 design 5.4): the board, and each root column
 * beside it, absolutely placed from `layoutFrame`; inside a column, splits share the height by
 * weight. `side`, while given (the wizard, settings or About), takes the header's column.
 */
export function LayoutFrame({
  boardOverlay,
  side,
}: {
  boardOverlay?: ReactNode;
  side?: ReactNode;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowSize();
  const { layout, setLayout } = useLayout();
  const headerColumn = layout.root.children.findIndex((c) =>
    panelsOf(c).some((p) => p.kind === 'header'),
  );
  const minSize = frameMinSize(Boolean(side));
  const frame = layoutFrame(layout, width, height, minSize);
  const container = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointer();
  // Every change starts from the layout as drawn: the untouched default may be in its wide form.
  const drawn = frame.layout;
  const { drag, startDrag } = useDragPanel(container, (ref, drop) =>
    setLayout(movePanel(drawn, ref, drop)),
  );
  const actions: Actions = {
    coarse,
    dragging: drag?.ref ?? null,
    startDrag,
    selectTab: (ref) => setLayout(selectTab(drawn, ref)),
    beginResize: (path, index, mins) => () => {
      const base = drawn;
      return {
        move: (delta, sizes) => setLayout(resize(base, path, index, delta, sizes, mins)),
        cancel: layoutCheckpoint(),
      };
    },
    even: (path, index) => setLayout(evenSplit(drawn, path, index)),
  };
  if (frame.narrow) return <NarrowStack frame={frame} overlay={boardOverlay} side={side} />;

  const boardIndex = drawn.root.children.findIndex((c) => c.type === 'board');
  const hit = coarse ? HAIRLINE_HIT_COARSE : HAIRLINE_HIT;
  return (
    <div ref={container} className="relative h-full w-full">
      <MainBoard rect={frame.board} overlay={boardOverlay} lines={drawn.lines} />
      {frame.columns.map((column) => {
        const node = drawn.root.children[column.index];
        const leftOfBoard = column.index < boardIndex;
        return (
          <aside
            key={column.index}
            className={cn(
              'absolute inset-y-0 flex flex-col border-hairline bg-panel',
              leftOfBoard ? 'border-r' : 'border-l',
            )}
            style={{ left: column.x, width: column.width }}
          >
            {side && column.index === headerColumn ? (
              side
            ) : (
              <NodeView node={node} path={[column.index]} actions={actions} />
            )}
          </aside>
        );
      })}
      {!side &&
        frame.hairlines.map((line) => {
          const [a, b] = [line.index, line.index + 1].map((index) =>
            frame.columns.find((c) => c.index === index)!,
          );
          const mins: [number, number] = [
            minWidth(drawn.root.children[a.index], minSize),
            minWidth(drawn.root.children[b.index], minSize),
          ];
          return (
            <Hairline
              key={line.index}
              dir="row"
              coarse={coarse}
              sizes={[a.width, b.width]}
              begin={actions.beginResize([], line.index, mins)}
              onEven={() => actions.even([], line.index)}
              style={{ left: line.x - hit / 2 }}
            />
          );
        })}
      {drag?.outline && (
        <div
          data-drop-outline
          data-drop-kind={drag.drop?.kind}
          className="pointer-events-none fixed z-40 border-2 border-drop bg-drop/10"
          style={{
            left: drag.outline.x,
            top: drag.outline.y,
            width: drag.outline.width,
            height: drag.outline.height,
          }}
        />
      )}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 bg-pop px-2 py-1 text-[12px] text-text shadow-md"
          style={{ left: drag.point.x + 12, top: drag.point.y + 12 }}
        >
          {t(panelLabelKey(drag.ref))}
        </div>
      )}
    </div>
  );
}
