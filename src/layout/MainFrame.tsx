import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { useVariation } from '../analysis/useVariation';
import { variationBoard } from '../analysis/variation';
import { useViewStore } from '../analysis/viewStore';
import { BoardCanvas } from '../board/BoardCanvas';
import { useWheelNavigation } from '../board/useWheelNavigation';
import { useGameStore } from '../game/gameStore';
import { useDeviceStore } from '../device/deviceStore';
import type { Move } from '../transport/generated/Move';
import { computeFrame } from './frame';
import { useWindowSize } from './useWindowSize';

/** An empty 19×19 board, until the first game snapshot arrives. */
const EMPTY_19 = Array.from({ length: 19 * 19 }, () => null);
const NO_DISCS: never[] = [];

/**
 * The main screen: a square board area on the left, one panel running the full height on the
 * right. `boardOverlay` lies over the board (the drop target).
 */
export function MainFrame({ panel, boardOverlay }: { panel: ReactNode; boardOverlay?: ReactNode }) {
  const { width, height } = useWindowSize();
  const { board, panel: panelBox } = computeFrame(width, height);
  const snapshot = useGameStore((s) => s.snapshot);
  const boardArea = useRef<HTMLDivElement>(null);
  useWheelNavigation(boardArea);
  const { i18n } = useTranslation();
  const { shown, fading } = useShownCandidates();
  const hidden = useViewStore((s) => s.hidden || s.held);
  const discLines = useDeviceStore((s) => s.settings.discLines);
  const coordinates = useDeviceStore((s) => s.settings.showCoordinates);
  useVariation();
  const variation = useViewStore((s) => s.variation);
  const step = useViewStore((s) => s.step);
  const hoveredCandidate = useViewStore((s) => (s.hover?.source === 'board' ? s.hover.move : null));
  const line = useMemo(
    () =>
      variation && snapshot && step !== null
        ? variationBoard(snapshot.stones, snapshot.size, variation, step)
        : null,
    [variation, snapshot, step],
  );
  const onHoverCandidate = useCallback((move: Move | null) => {
    const { hover, setHover } = useViewStore.getState();
    if (move !== null) setHover({ move, source: 'board' });
    else if (hover?.source === 'board') setHover(null);
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={boardArea} className="absolute" style={{ left: board.x, top: board.y }}>
        <BoardCanvas
          cssSize={board.size}
          boardSize={snapshot?.size ?? 19}
          stones={line?.stones ?? snapshot?.stones ?? EMPTY_19}
          // The game's last-move dot is hidden while a line shows.
          lastMove={line ? null : (snapshot?.lastMove ?? null)}
          candidates={hidden ? NO_DISCS : shown}
          discLines={discLines}
          coordinates={coordinates}
          lang={i18n.language}
          catchingUp={fading}
          onHoverCandidate={onHoverCandidate}
          hoveredCandidate={hoveredCandidate}
          variation={line}
        />
        {boardOverlay}
      </div>
      <aside
        className="absolute inset-y-0 flex flex-col border-l border-hairline bg-panel"
        style={{ left: panelBox.x, width: panelBox.width }}
      >
        {panel}
      </aside>
    </div>
  );
}
