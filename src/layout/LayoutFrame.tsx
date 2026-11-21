import { cn } from 'cn';
import { type ReactNode, useRef } from 'react';
import { TabRow } from '../panel/TabRow';
import { FIXED_HEIGHT, SIDE_MIN_WIDTH } from './constants';
import { type Frame, layoutFrame } from './frameGeometry';
import { MainBoard } from './MainBoard';
import { type Layout, type Node, type PanelRef, panelsOf, refId, sameRef } from './model';
import { panelMinSize, panelSpec } from './registry';
import { useElementSize } from './useElementSize';
import { useLayout } from './useLayout';
import { PanelSizeContext } from './usePanelWidth';
import { useWindowSize } from './useWindowSize';

/** One panel: measured, so what it holds can size itself to it. */
function PanelView({ panel }: { panel: PanelRef }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const { Component } = panelSpec(panel.kind);
  return (
    <div
      ref={ref}
      data-panel={refId(panel)}
      data-max-rows={panel.maxRows}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <PanelSizeContext.Provider value={size}>
        <Component panel={panel} width={size.width} height={size.height} />
      </PanelSizeContext.Provider>
    </div>
  );
}

const fixedHeight = (node: Node) => node.type === 'panel' && FIXED_HEIGHT.has(node.panel.kind);

function NodeView({
  node,
  onSelectTab,
}: {
  node: Node;
  onSelectTab(ref: PanelRef): void;
}): ReactNode {
  switch (node.type) {
    case 'board':
      return null;
    case 'panel':
      return <PanelView panel={node.panel} />;
    case 'tabs':
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabRow panels={node.panels} active={node.active} onSelect={onSelectTab} />
          <PanelView panel={node.panels[node.active]} />
        </div>
      );
    case 'split': {
      const column = node.dir === 'column';
      return (
        <div className={cn('flex min-h-0 min-w-0 flex-1', column ? 'flex-col' : 'flex-row')}>
          {node.children.map((child, i) => (
            <div
              key={child.type === 'panel' ? refId(child.panel) : i}
              className={cn(
                'flex min-h-0 min-w-0',
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
              <NodeView node={child} onSelectTab={onSelectTab} />
            </div>
          ))}
        </div>
      );
    }
  }
}

function minHeightOf(node: Node): number | undefined {
  if (node.type === 'panel') return panelMinSize(node.panel).height;
  if (node.type === 'tabs') return Math.max(...node.panels.map((p) => panelMinSize(p).height));
  return undefined;
}

/** A tab group's active panel becomes `ref`. */
function selectTab(layout: Layout, ref: PanelRef): Layout {
  const visit = (node: Node): Node => {
    if (node.type === 'tabs') {
      const i = node.panels.findIndex((p) => sameRef(p, ref));
      return i < 0 ? node : { ...node, active: i };
    }
    if (node.type === 'split') return { ...node, children: node.children.map(visit) };
    return node;
  };
  return { ...layout, root: visit(layout.root) as Layout['root'] };
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
              <NodeView node={node} onSelectTab={() => {}} />
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
  const { width, height } = useWindowSize();
  const { layout, setLayout } = useLayout();
  const headerColumn = layout.root.children.findIndex((c) =>
    panelsOf(c).some((p) => p.kind === 'header'),
  );
  const minSize = (ref: PanelRef) => {
    const base = panelMinSize(ref);
    return side && ref.kind === 'header'
      ? { ...base, width: Math.max(base.width, SIDE_MIN_WIDTH) }
      : base;
  };
  const frame = layoutFrame(layout, width, height, minSize);
  if (frame.narrow) return <NarrowStack frame={frame} overlay={boardOverlay} side={side} />;

  const boardIndex = frame.layout.root.children.findIndex((c) => c.type === 'board');
  const onSelectTab = (ref: PanelRef) => setLayout(selectTab(layout, ref));
  return (
    <div className="relative h-full w-full">
      <MainBoard rect={frame.board} overlay={boardOverlay} />
      {frame.columns.map((column) => {
        const node = frame.layout.root.children[column.index];
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
              <NodeView node={node} onSelectTab={onSelectTab} />
            )}
          </aside>
        );
      })}
    </div>
  );
}
