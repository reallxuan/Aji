import { useCallback, useMemo, useRef, type ReactNode } from 'react';
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
import { useScoringStore } from '../scoring/scoringStore';
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
  const scoring = useScoringStore((s) => s.active);
  const score = useScoringStore((s) => s.score);
  const dead = useScoringStore((s) => s.dead);
  const variation = useViewStore((s) => s.variation);
  const step = useViewStore((s) => s.step);
  const hoveredCandidate = useViewStore((s) => (s.hover?.source === 'board' ? s.hover.move : null));
  const line = useMemo(
    () =>
      lines === 'board' && !scoring && variation && snapshot && step !== null
        ? variationBoard(snapshot.stones, snapshot.size, variation, step)
        : null,
    [lines, scoring, variation, snapshot, step],
  );
  const onHoverCandidate = useCallback((move: Move | null) => {
    const { hover, setHover } = useViewStore.getState();
    if (move !== null) setHover({ move, source: 'board' });
    else if (hover?.source === 'board' && !hover.pinned) setHover(null);
  }, []);
  // Touch (design 5.6): a tap pins a candidate's line, a tap elsewhere clears it. Tapping the
  // pinned candidate again is M3's (it will play it), and does nothing yet.
  const onTapCandidate = useCallback((move: Move | null) => {
    const { hover, setHover } = useViewStore.getState();
    if (move === null) {
      if (hover) setHover(null);
    } else if (!(hover?.pinned && sameMove(hover.move, move))) {
      setHover({ move, source: 'board', pinned: true });
    }
  }, []);
  const showNext = useSettingsStore((s) => s.settings?.showNextMove ?? true);
  const discs = hidden || scoring ? NO_DISCS : shown;
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
        lastMove={line ? null : (snapshot?.lastMove ?? null)}
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
        onTapPoint={scoring ? onTapPoint : undefined}
        onSwipeStep={onSwipeStep}
        hoveredCandidate={hoveredCandidate}
        variation={line}
      />
      {overlay}
    </div>
  );
}
