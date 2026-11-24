import { setupEdit } from '../edit/setupEdit';
import { useMarkEdit } from '../edit/useMarkEdit';
import { FreehandOverlay } from '../edit/FreehandOverlay';
import { badgesFor, branchLetter, type Badge } from '../board/badges';
import { numbersFor } from '../board/moveNumbers';
import { BoardMenu, type BoardMenuTarget } from '../edit/BoardMenu';
import { boardNodes } from '../edit/boardNodes';
import { useModeStore } from '../edit/modeStore';
import { edit } from '../game/editActions';
import { navigate } from '../game/actions';
import { useActionContext } from '../game/useActionContext';
import { useTreeStore } from '../game/treeStore';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { nextRingPoint, sameMove } from '../analysis/candidates';
import { useVariation } from '../analysis/useVariation';
import { variationBoard } from '../analysis/variation';
import { useViewStore } from '../analysis/viewStore';
import { BoardCanvas } from '../board/BoardCanvas';
import { scoredOwnership, settledOwnership } from '../board/ownership';
import { useBoardStyle } from '../board/useBoardStyle';
import { useEstimateStore } from '../analysis/estimateStore';
import { stepLineOrGame, useWheelNavigation } from '../board/useWheelNavigation';
import { useDeviceStore } from '../device/deviceStore';
import { useGameStore } from '../game/gameStore';
import { useSettingsStore } from '../settings/settingsStore';
import { useFrameNavigate } from '../game/useFrameNavigate';
import { scoringInProgress, useScoringStore } from '../scoring/scoringStore';
import { useScoringSync } from '../scoring/useScoringSync';
import type { Move } from '../transport/generated/Move';
import type { Point } from '../transport/generated/Point';
import { useTransport } from '../transport/TransportProvider';
import type { Rect } from './frameGeometry';
import type { Layout } from './model';

/** An empty 19×19 board, until the first game snapshot arrives. */
const EMPTY_19 = Array.from({ length: 19 * 19 }, () => null);
const NO_DISCS: never[] = [];

/** The main board at `rect`, with its discs, hover line and wheel; `overlay` lies over it. */
export function MainBoard({
  rect,
  overlay,
  lines = 'board',
}: {
  rect: Rect;
  overlay?: ReactNode;
  /** Where the hovered line is drawn: here, or (Thinking) on the first sub-board. */
  lines?: Layout['lines'];
}) {
  const snapshot = useGameStore((s) => s.snapshot);
  const ctx = useActionContext();
  const markEdit = useMarkEdit(ctx);
  const mode = useModeStore((s) => s.mode);
  const markupTool = useModeStore((s) => s.markupTool);
  const tree = useTreeStore((s) => s.tree);
  const currentTree = tree?.revision === snapshot?.treeRevision ? tree : null;
  const nodes = useMemo(() => boardNodes(currentTree), [currentTree]);
  const [menu, setMenu] = useState<BoardMenuTarget | null>(null);
  const moveNumbers = useDeviceStore((s) => s.settings.moveNumbers);
  const boardArea = useRef<HTMLDivElement>(null);
  useWheelNavigation(boardArea);
  const { i18n } = useTranslation();
  const { current, shown, fading } = useShownCandidates();
  const hidden = useViewStore((s) => s.hidden || s.held);
  const discLines = useDeviceStore((s) => s.settings.discLines);
  const coordinates = useDeviceStore((s) => s.settings.showCoordinates);
  const style = useBoardStyle();
  useVariation();
  useScoringSync();
  const transport = useTransport();
  // Final scoring (design 5.8): no discs and no lines, the count's squares, taps flip groups.
  const scoring = useScoringStore(scoringInProgress);
  useEffect(
    () =>
      useScoringStore.subscribe((s) => {
        if (scoringInProgress(s)) setMenu(null);
      }),
    [],
  );
  const score = useScoringStore((s) => s.score);
  const dead = useScoringStore((s) => s.dead);
  const variation = useViewStore((s) => s.variation);
  const step = useViewStore((s) => s.step);
  const hoveredCandidate = useViewStore((s) => (s.hover?.source === 'board' ? s.hover.move : null));
  const line = useMemo(
    () =>
      lines === 'board' && mode === 'normal' && !scoring && variation && snapshot && step !== null
        ? variationBoard(snapshot.stones, snapshot.size, variation, step)
        : null,
    [lines, mode, scoring, variation, snapshot, step],
  );
  const onHoverCandidate = useCallback((move: Move | null) => {
    const { hover, setHover } = useViewStore.getState();
    if (move !== null) setHover({ move, source: 'board' });
    else if (hover?.source === 'board' && !hover.pinned) setHover(null);
  }, []);
  const play = useCallback(
    (point: Point) => {
      if (
        !snapshot ||
        mode !== 'normal' ||
        scoringInProgress() ||
        snapshot.stones[point.y * snapshot.size + point.x]
      )
        return;
      void edit(ctx, { kind: 'play', mv: { type: 'play', x: point.x, y: point.y } });
    },
    [snapshot, mode, ctx],
  );
  const playCandidate = (move: Move) => {
    if (move.type === 'play') play(move);
  };
  const onTapCandidate = (move: Move | null) => {
    const { hover, setHover } = useViewStore.getState();
    if (move === null) {
      if (hover) setHover(null);
    } else if (hover?.pinned && sameMove(hover.move, move)) {
      playCandidate(move);
    } else {
      setHover({ move, source: 'board', pinned: true });
    }
  };
  const showNext = useSettingsStore((s) => s.settings?.showNextMove ?? true);
  const editing = !scoring && mode === 'normal';
  const discs = hidden || !editing ? NO_DISCS : shown;
  const badges = useMemo(
    () => (editing && snapshot ? badgesFor(snapshot.continuations, discs) : []),
    [editing, snapshot, discs],
  );
  const tryoutNumbers = useMemo(
    () =>
      snapshot?.tryout == null || scoring || snapshot.treeRevision !== tree?.revision
        ? []
        : snapshot.placed.flatMap(({ point, node }) => {
            const placed = nodes.get(node);
            return placed?.tryout ? [{ point, n: placed.tryoutNumber }] : [];
          }),
    [snapshot, tree, nodes, scoring],
  );
  const numbers = useMemo(() => {
    if (!snapshot || scoring) return [];
    const placed =
      snapshot.tryout === null
        ? snapshot.placed
        : snapshot.placed.filter((p) => !nodes.get(p.node)?.tryout);
    return numbersFor(placed, snapshot.moveNumber, moveNumbers);
  }, [snapshot, scoring, nodes, moveNumbers]);
  const openMenu = (
    point: Point,
    at: Point,
    branches?: BoardMenuTarget['branches'],
    chooseMove = false,
  ) => {
    if (!snapshot || mode === 'markup' || scoringInProgress()) return;
    if (mode === 'setup' && !snapshot.stones[point.y * snapshot.size + point.x]) return;
    useViewStore.getState().setHover(null);
    setMenu({ mode, point, at, branches, chooseMove, revision: snapshot.revision });
  };
  const activateBadge = (badge: Badge, at: Point, chooseMove: boolean) => {
    if (!snapshot || mode !== 'normal' || scoringInProgress()) return;
    const branches = snapshot.continuations.flatMap(({ mv, node, tryout }, i) =>
      mv?.type === 'play' && mv.x === badge.point.x && mv.y === badge.point.y
        ? [{ node, letter: branchLetter(i), tryout }]
        : [],
    );
    if (branches.length === 1 && chooseMove) void navigate(ctx, { node: branches[0].node });
    else if (branches.length) openMenu(badge.point, at, branches, chooseMove);
  };
  const nextMove = snapshot?.nextMove ?? null;
  const nextRing = useMemo(
    () => (scoring ? null : nextRingPoint(nextMove, showNext, discs, line !== null)),
    [scoring, nextMove, showNext, discs, line],
  );
  // 形势判断: the settled points of the position on the board, not of a hovered line (5.7).
  const estimate = useEstimateStore((s) => s.on);
  const ownership = useMemo(() => {
    if (scoring)
      return score && snapshot ? scoredOwnership(score.owners, snapshot.stones, dead) : null;
    return estimate && current?.ownership && snapshot && !line
      ? settledOwnership(current.ownership, snapshot.stones)
      : null;
  }, [scoring, score, dead, estimate, current, snapshot, line]);
  const onTapPoint = useCallback(
    (point: Point) => void useScoringStore.getState().toggle(transport, point),
    [transport],
  );
  const markPoint = (point: Point) => {
    if (markupTool !== 'freehand') void markEdit({ kind: 'toggle', point, tool: markupTool });
  };
  const setup = mode === 'setup' && !scoring && snapshot?.tryout === null;
  const setupPoint = (point: Point) => {
    if (!setup || scoringInProgress()) return;
    const { setupTool, takeAlternateColor, setSetupTool } = useModeStore.getState();
    if (setupTool === 'insert') {
      setSetupTool('black');
      setupEdit(ctx, (s) => ({
        kind: 'insertMove',
        color: s.nextColor,
        mv: { type: 'play', ...point },
      }));
      return;
    }
    setupEdit(ctx, (s) => {
      const color = setupTool === 'alternate' ? takeAlternateColor(s.nextColor) : setupTool;
      return {
        kind: 'setupStone',
        point,
        stone: s.stones[point.y * s.size + point.x] === color ? null : color,
      };
    });
  };
  const moveStone = (from: Point, to: Point) =>
    setupEdit(ctx, () => ({ kind: 'moveStone', from, to }));
  const go = useFrameNavigate();
  const onSwipeStep = useCallback((forward: boolean) => stepLineOrGame(forward, go), [go]);

  return (
    <div
      ref={boardArea}
      data-board
      data-line={line ? 'shown' : undefined}
      className="absolute"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <BoardCanvas
        cssSize={rect.width}
        boardSize={snapshot?.size ?? 19}
        stones={line?.stones ?? snapshot?.stones ?? EMPTY_19}
        // The game's last-move dot is hidden while a line shows.
        lastMove={
          line ||
          [...numbers, ...tryoutNumbers].some(
            ({ point }) =>
              snapshot?.lastMove?.type === 'play' &&
              point.x === snapshot.lastMove.x &&
              point.y === snapshot.lastMove.y,
          )
            ? null
            : (snapshot?.lastMove ?? null)
        }
        marks={snapshot?.marks}
        badges={badges}
        numbers={numbers}
        tryoutNumbers={tryoutNumbers}
        onClickPoint={play}
        onClickCandidate={playCandidate}
        onClickBadge={(badge, at) => activateBadge(badge, at, true)}
        onDragStone={setup ? moveStone : undefined}
        onContextPoint={editing || setup ? openMenu : undefined}
        onContextBadge={editing ? (badge, at) => activateBadge(badge, at, false) : undefined}
        candidates={discs}
        nextRing={nextRing}
        ownership={ownership}
        discLines={discLines}
        coordinates={coordinates}
        boardStyle={style.board}
        stoneStyle={style.stones}
        lang={i18n.language}
        catchingUp={fading}
        onHoverCandidate={onHoverCandidate}
        onTapCandidate={onTapCandidate}
        onTapPoint={
          scoring ? onTapPoint : mode === 'markup' ? markPoint : setup ? setupPoint : undefined
        }
        onSwipeStep={onSwipeStep}
        hoveredCandidate={hoveredCandidate}
        variation={line}
      />
      {snapshot && !scoring && (
        <FreehandOverlay
          key={`${snapshot.gameRevision}:${snapshot.node}`}
          active={mode === 'markup' && markupTool === 'freehand'}
          cssSize={rect.width}
          boardSize={snapshot.size}
          coordinates={coordinates}
        />
      )}
      {menu &&
        snapshot &&
        menu.revision === snapshot.revision &&
        !scoring &&
        menu.mode === mode && (
          <BoardMenu
            target={menu}
            nodes={nodes}
            snapshot={snapshot}
            onClose={() => setMenu(null)}
          />
        )}
      {overlay}
    </div>
  );
}
