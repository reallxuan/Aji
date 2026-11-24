import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { branchLetter } from '../board/badges';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '../components/ui/context-menu';
import { navigate } from '../game/actions';
import { useGameStore } from '../game/gameStore';
import { useActionContext } from '../game/useActionContext';
import { useTreeStore, hasVariations } from '../game/treeStore';
import { scoringInProgress, useScoringStore } from '../scoring/scoringStore';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { GameTree } from '../transport/generated/GameTree';
import { currentTreeTarget, NodeMenu } from './NodeMenu';
import { layoutTree, visibleCells, visibleEdges, type TreeCell } from './layoutTree';

const STEP = 26;
const HEADER = 32;
const PADDING = 36;

/** Shift the scroll offset only if a stone or its annotation is clipped. */
function reveal(offset: number, center: number, size: number) {
  const margin = Math.min(24, size / 2);
  return Math.max(0, Math.min(center - margin, Math.max(offset, center + margin - size)));
}

function TreeDrawing({
  tree,
  snapshot,
  width,
  height,
}: {
  tree: GameTree;
  snapshot: GameSnapshot;
  width: number;
  height: number;
}) {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const layout = useMemo(() => layoutTree(tree), [tree]);
  const mainMoves = useMemo(
    () => layout.cells.reduce((moves, c) => (c.lane === 0 ? c.moveNumber : moves), 0),
    [layout],
  );
  const suppressClick = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ left: 0, top: 0 });
  const [target, setTarget] = useState<{ id: number; revision: number } | null>(null);
  const scoring = useScoringStore(scoringInProgress);
  const across = width >= height;
  const laneStep = across ? 30 : 34;
  const viewHeight = Math.max(0, height - HEADER);
  const current = layout.byId.get(snapshot.node);
  const point = (c: TreeCell) => {
    const depth = PADDING + c.depth * STEP;
    const lane = PADDING + c.lane * laneStep;
    return across ? [depth, lane] : [lane, depth];
  };
  const currentX = current && point(current)[0];
  const currentY = current && point(current)[1];
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || currentX === undefined || currentY === undefined || width <= 0 || viewHeight <= 0)
      return;
    el.scrollLeft = reveal(el.scrollLeft, currentX, el.clientWidth || width);
    el.scrollTop = reveal(el.scrollTop, currentY, el.clientHeight || viewHeight);
    const { scrollLeft: left, scrollTop: top } = el;
    setOffset((old) => (old.left === left && old.top === top ? old : { left, top }));
  }, [currentX, currentY, width, viewHeight, layout]);
  const dOffset = across ? offset.left : offset.top;
  const lOffset = across ? offset.top : offset.left;
  const window = {
    from: Math.floor((dOffset - PADDING) / STEP) - 1,
    to: Math.ceil((dOffset + (across ? width : viewHeight) - PADDING) / STEP) + 1,
    laneFrom: Math.floor((lOffset - PADDING) / laneStep) - 1,
    laneTo: Math.ceil((lOffset + (across ? viewHeight : width) - PADDING) / laneStep) + 1,
  };
  const depthSize = PADDING * 2 + (layout.depth - 1) * STEP;
  const laneSize = PADDING * 2 + (layout.lanes - 1) * laneStep;
  const letters = useMemo(
    () => new Map(snapshot.continuations.map((c, i) => [c.node, branchLetter(i)])),
    [snapshot.continuations],
  );
  const hit = (element: EventTarget | null) => {
    const id =
      element instanceof Element &&
      element.closest('[data-tree-node]')?.getAttribute('data-tree-node');
    setTarget(
      id && currentTreeTarget(snapshot) ? { id: Number(id), revision: snapshot.revision } : null,
    );
  };
  const menu =
    !scoring && target?.revision === snapshot.revision ? layout.byId.get(target.id) : undefined;
  const go = (c: TreeCell) => {
    if (currentTreeTarget(snapshot)) void navigate(ctx, { node: c.id });
  };
  return (
    <>
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 whitespace-nowrap px-4 text-xs text-text-muted">
        <span>
          {across && width >= 300
            ? t('tree.position', {
                n: snapshot.moveNumber,
                next: t('tree.continuations', { count: snapshot.continuations.length }),
              })
            : t('analysis.graph.moveOnly', { n: snapshot.moveNumber })}
        </span>
        <span>
          {across && width >= 300
            ? t('tree.mainLine', { n: mainMoves })
            : t('tree.continuations', { count: snapshot.continuations.length })}
        </span>
      </div>
      <ContextMenu
        onOpenChange={(open) => {
          if (open) suppressClick.current = true;
          else setTarget(null);
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-auto overscroll-contain"
            onScroll={(e) =>
              setOffset({ left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop })
            }
            onPointerDownCapture={(e) => {
              suppressClick.current = false;
              hit(e.target);
            }}
            onContextMenuCapture={(e) => hit(e.target)}
          >
            <svg
              width={across ? depthSize : laneSize}
              height={across ? laneSize : depthSize}
              className="block select-none"
              aria-label={t('layout.panels.tree')}
            >
              {visibleEdges(layout, window).map((c) => {
                const parent = layout.byId.get(c.parent!)!;
                const [x, y] = point(parent);
                const [cx, cy] = point(c);
                const d =
                  parent.lane === c.lane
                    ? `M ${x} ${y} L ${cx} ${cy}`
                    : across
                      ? `M ${x} ${y} V ${cy - 6} Q ${x} ${cy} ${x + 6} ${cy} H ${cx}`
                      : `M ${x} ${y} H ${cx - 6} Q ${cx} ${y} ${cx} ${y + 6} V ${cy}`;
                return (
                  <path
                    key={c.id}
                    d={d}
                    fill="none"
                    className={c.flags & 2 ? 'stroke-[#e2a33b]' : 'stroke-text-muted'}
                    opacity={c.flags & 2 ? 1 : 0.65}
                    strokeWidth={1.4}
                    strokeDasharray={c.flags & 2 ? '3 3' : undefined}
                  />
                );
              })}
              {visibleCells(layout, window).map((c) => {
                const [x, y] = point(c);
                const letter = letters.get(c.id);
                const trying = !!(c.flags & 2);
                const current = c.id === snapshot.node;
                const noMove = !!(c.flags & 4);
                return (
                  <g
                    key={c.id}
                    data-tree-node={c.id}
                    transform={`translate(${x} ${y})`}
                    role="button"
                    tabIndex={0}
                    aria-current={current ? 'step' : undefined}
                    aria-label={t('analysis.graph.moveOnly', { n: c.moveNumber })}
                    className="cursor-pointer"
                    onClick={() => {
                      if (!suppressClick.current) go(c);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        go(c);
                      }
                    }}
                  >
                    <rect x={-12} y={-13} width={26} height={26} fill="transparent" />
                    {current && (
                      <circle r={9.5} fill="none" className="stroke-text" strokeWidth={2} />
                    )}
                    {noMove ? (
                      <rect
                        x={-4.5}
                        y={-4.5}
                        width={9}
                        height={9}
                        fill="none"
                        className={trying ? 'stroke-[#e2a33b]' : 'stroke-text-muted'}
                        strokeDasharray={trying ? '2 1.6' : undefined}
                      />
                    ) : (
                      <circle
                        r={5.5}
                        fill={c.color === 'black' ? '#111' : '#efede6'}
                        stroke={trying ? '#e2a33b' : c.color === 'black' ? '#6b6b70' : '#bdb9ae'}
                        strokeWidth={1.2}
                        strokeDasharray={trying ? '2 1.6' : undefined}
                      />
                    )}
                    {!!(c.flags & 1) && <circle cx={-7} cy={-8} r={2.2} fill="#c9a66b" />}
                    {letter && (
                      <g>
                        <rect
                          x={5}
                          y={-15}
                          width={Math.max(11, letter.length * 7 + 4)}
                          height={11}
                          rx={2.5}
                          className={trying ? 'fill-[#e2a33b]' : 'fill-text'}
                        />
                        <text
                          x={5 + Math.max(11, letter.length * 7 + 4) / 2}
                          y={-6.6}
                          textAnchor="middle"
                          fontSize={8.5}
                          fontWeight={700}
                          className="fill-panel"
                        >
                          {letter}
                        </text>
                      </g>
                    )}
                    {!noMove && c.lane === 0 && c.moveNumber % 5 === 0 && (
                      <text
                        x={across ? 0 : -14}
                        y={across ? 20 : 3.5}
                        textAnchor={across ? 'middle' : 'end'}
                        fontSize={10}
                        className="fill-text-muted"
                      >
                        {c.moveNumber}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </ContextMenuTrigger>
        {menu && (
          <ContextMenuContent className="min-w-44 whitespace-nowrap">
            <NodeMenu
              id={menu.id}
              snapshot={snapshot}
              root={menu.parent === null}
              mainLine={menu.lane === 0}
              firstChild={menu.parent === null || layout.byId.get(menu.parent)?.lane === menu.lane}
              tryout={!!(menu.flags & 2)}
              start={
                snapshot.tryout === null ? undefined : layout.byId.get(snapshot.tryout)?.moveNumber
              }
            />
          </ContextMenuContent>
        )}
      </ContextMenu>
    </>
  );
}

export function TreePanel({ width, height }: { width: number; height: number }) {
  const { t } = useTranslation();
  const snapshot = useGameStore((s) => s.snapshot);
  const tree = useTreeStore((s) => s.tree);
  const branched = useMemo(() => hasVariations(tree), [tree]);
  if (!tree || !snapshot || tree.revision !== snapshot.treeRevision) return null;
  if (!branched) return <p className="px-4 py-2 text-xs text-text-muted">{t('tree.empty')}</p>;
  return <TreeDrawing tree={tree} snapshot={snapshot} width={width} height={height} />;
}
