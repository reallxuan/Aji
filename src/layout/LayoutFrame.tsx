import { cn } from 'cn';
import { type ReactNode, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasVariations } from '../game/treeStore';
import { TabRow } from '../panel/TabRow';
import { scoringLayout } from '../scoring/scoringLayout';
import { useScoringStore } from '../scoring/scoringStore';
import { FIXED_HEIGHT, folded, HAIRLINE_HIT, HAIRLINE_HIT_COARSE } from './constants';
import { layoutFrame, minWidth } from './frameGeometry';
import { Hairline } from './Hairline';
import { MainBoard } from './MainBoard';
import { type Node, panelsOf, refId } from './model';
import { evenSplit, movePanel, resize, selectTab } from './ops';
import { NarrowFrame } from './NarrowFrame';
import { type Actions, PanelView, STILL } from './PanelView';
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
  branches,
}: {
  node: Node;
  path: number[];
  actions: Actions;
  branches: boolean;
}): ReactNode {
  switch (node.type) {
    case 'board':
      return null;
    case 'panel':
      if (folded(node, branches)) return null;
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
      const visible = node.children
        .map((child, i) => ({ child, i }))
        .filter(({ child }) => !folded(child, branches));
      return (
        <div className={cn('flex min-h-0 min-w-0 flex-1', column ? 'flex-col' : 'flex-row')}>
          {visible.map(({ child, i }, position) => {
            const previous = visible[position - 1];
            const prev = previous?.child;
            // A line beside a panel of fixed height would have nothing to move.
            const resizable = previous && !(column && (fixedHeight(prev) || fixedHeight(child)));
            const mins: [number, number] = column
              ? [minHeightOf(prev) ?? 0, minHeightOf(child) ?? 0]
              : [
                  minWidth(prev ?? child, panelMinSize, branches),
                  minWidth(child, panelMinSize, branches),
                ];
            return (
              <div
                key={child.type === 'panel' ? refId(child.panel) : i}
                className={cn(
                  'relative flex min-h-0 min-w-0',
                  previous && (column ? 'border-t border-hairline' : 'border-l border-hairline'),
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
                    begin={actions.beginResize(path, previous.i, i, mins)}
                    onEven={() => actions.even(path, previous.i, i)}
                  />
                )}
                <NodeView node={child} path={[...path, i]} actions={actions} branches={branches} />
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
  const branches = useHasVariations();
  const { width, height } = useWindowSize();
  const { layout: stored, setLayout } = useLayout();
  // While scoring the count takes the bar's place and the graph's (design 5.8), drawn only.
  const scoring = useScoringStore((s) => s.active);
  const layout = useMemo(() => (scoring ? scoringLayout(stored) : stored), [scoring, stored]);
  const headerColumn = layout.root.children.findIndex((c) =>
    panelsOf(c).some((p) => p.kind === 'header'),
  );
  // Narrow or wide is decided without the side's wider column, so opening settings never flips
  // the window into the phone arrangement; a side that does not fit takes the header's width.
  const plain = layoutFrame(layout, width, height, frameMinSize(false), branches);
  const withSide = side ? layoutFrame(layout, width, height, frameMinSize(true), branches) : plain;
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
    selectTab: (ref) => setLayout(selectTab(stored, ref)),
    beginResize: (path, first, second, mins) => () => {
      const base = drawn;
      return {
        move: (delta, sizes) => setLayout(resize(base, path, first, delta, sizes, mins, second)),
        cancel: layoutCheckpoint(),
      };
    },
    even: (path, first, second) => setLayout(evenSplit(drawn, path, first, second)),
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
              <NodeView
                node={node}
                path={[column.index]}
                branches={branches}
                actions={scoring ? STILL : actions}
              />
            )}
          </aside>
        );
      })}
      {!side &&
        !scoring &&
        frame.hairlines.map(({ left, right }) => {
          const mins: [number, number] = [
            minWidth(drawn.root.children[left.index], minSize, branches),
            minWidth(drawn.root.children[right.index], minSize, branches),
          ];
          return (
            <Hairline
              key={`${left.index}-${right.index}`}
              dir="row"
              coarse={coarse}
              sizes={[left.width, right.width]}
              begin={actions.beginResize([], left.index, right.index, mins)}
              onEven={() => actions.even([], left.index, right.index)}
              style={{ left: right.x - hit / 2 }}
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
          className="pointer-events-none fixed z-50 bg-pop px-2 py-1 text-[0.75rem] text-text shadow-md"
          style={{ left: drag.point.x + 12, top: drag.point.y + 12 }}
        >
          {t(panelLabelKey(drag.ref))}
        </div>
      )}
    </div>
  );
}
