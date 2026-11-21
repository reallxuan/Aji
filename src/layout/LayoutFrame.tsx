import { cn } from 'cn';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TabRow } from '../panel/TabRow';
import { FIXED_HEIGHT, HAIRLINE_HIT, HAIRLINE_HIT_COARSE } from './constants';
import { layoutFrame, minWidth } from './frameGeometry';
import { Hairline } from './Hairline';
import { MainBoard } from './MainBoard';
import { type Node, panelsOf, refId } from './model';
import { evenSplit, movePanel, resize, selectTab } from './ops';
import { NarrowFrame } from './NarrowFrame';
import { type Actions, PanelView } from './PanelView';
import { panelLabelKey, panelMinSize } from './registry';
import { useCoarsePointer } from './useCoarsePointer';
import { useDragPanel } from './useDragPanel';
import { frameMinSize } from './useDrawnLayout';
import { layoutCheckpoint, useLayout } from './useLayout';
import { useWindowSize } from './useWindowSize';

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

/**
 * The screen drawn from the device's layout (P2 M1 design 5.4): the board, and each root column
 * beside it, absolutely placed from `layoutFrame`; inside a column, splits share the height by
 * weight. `side`, while given (the wizard, settings or About), takes the header's column. A narrow
 * window gets the phone arrangement instead (design 5.5).
 */
export function LayoutFrame({
  boardOverlay,
  side,
  onCloseSide,
  sideLocked = false,
}: {
  boardOverlay?: ReactNode;
  side?: ReactNode;
  /** Closes `side`; in the narrow arrangement it shows as a sheet only when it can close. */
  onCloseSide?(): void;
  /** `side` cannot close for now (a running install): its sheet has no close control. */
  sideLocked?: boolean;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowSize();
  const { layout, setLayout } = useLayout();
  const headerColumn = layout.root.children.findIndex((c) =>
    panelsOf(c).some((p) => p.kind === 'header'),
  );
  // Narrow or wide is decided without the side's wider column, so opening settings never flips
  // the window into the phone arrangement; a side that does not fit takes the header's width.
  const plain = layoutFrame(layout, width, height, frameMinSize(false));
  const withSide = side ? layoutFrame(layout, width, height, frameMinSize(true)) : plain;
  const minSize = frameMinSize(Boolean(side) && !withSide.narrow);
  const frame = withSide.narrow ? plain : withSide;
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
  if (frame.narrow)
    return (
      <NarrowFrame
        overlay={boardOverlay}
        side={side}
        onCloseSide={onCloseSide}
        sideLocked={sideLocked}
      />
    );

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
