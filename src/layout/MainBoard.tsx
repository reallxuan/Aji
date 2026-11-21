import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { useVariation } from '../analysis/useVariation';
import { variationBoard } from '../analysis/variation';
import { useViewStore } from '../analysis/viewStore';
import { BoardCanvas } from '../board/BoardCanvas';
import { useBoardStyle } from '../board/useBoardStyle';
import { useWheelNavigation } from '../board/useWheelNavigation';
import { useDeviceStore } from '../device/deviceStore';
import { useGameStore } from '../game/gameStore';
import type { Move } from '../transport/generated/Move';
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
  const { shown, fading } = useShownCandidates();
  const hidden = useViewStore((s) => s.hidden || s.held);
  const discLines = useDeviceStore((s) => s.settings.discLines);
  const coordinates = useDeviceStore((s) => s.settings.showCoordinates);
  const style = useBoardStyle();
  useVariation();
  const variation = useViewStore((s) => s.variation);
  const step = useViewStore((s) => s.step);
  const hoveredCandidate = useViewStore((s) => (s.hover?.source === 'board' ? s.hover.move : null));
  const line = useMemo(
    () =>
      lines === 'board' && variation && snapshot && step !== null
        ? variationBoard(snapshot.stones, snapshot.size, variation, step)
        : null,
    [lines, variation, snapshot, step],
  );
  const onHoverCandidate = useCallback((move: Move | null) => {
    const { hover, setHover } = useViewStore.getState();
    if (move !== null) setHover({ move, source: 'board' });
    else if (hover?.source === 'board') setHover(null);
  }, []);

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
        candidates={hidden ? NO_DISCS : shown}
        discLines={discLines}
        coordinates={coordinates}
        boardStyle={style.board}
        stoneStyle={style.stones}
        lang={i18n.language}
        catchingUp={fading}
        onHoverCandidate={onHoverCandidate}
        hoveredCandidate={hoveredCandidate}
        variation={line}
      />
      {overlay}
    </div>
  );
}
