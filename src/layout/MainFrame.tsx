import { useCallback, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { useViewStore } from '../analysis/viewStore';
import { BoardCanvas } from '../board/BoardCanvas';
import { useWheelNavigation } from '../board/useWheelNavigation';
import { useGameStore } from '../game/gameStore';
import { useSettingsStore } from '../settings/settingsStore';
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
  const discLines = useSettingsStore((s) => s.settings?.discLines);
  const onHoverCandidate = useCallback((rank: number | null) => {
    const { hover, setHover } = useViewStore.getState();
    if (rank !== null) setHover({ rank, source: 'board' });
    else if (hover?.source === 'board') setHover(null);
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={boardArea} className="absolute" style={{ left: board.x, top: board.y }}>
        <BoardCanvas
          cssSize={board.size}
          boardSize={snapshot?.size ?? 19}
          stones={snapshot?.stones ?? EMPTY_19}
          lastMove={snapshot?.lastMove ?? null}
          candidates={hidden ? NO_DISCS : shown}
          discLines={discLines}
          lang={i18n.language}
          catchingUp={fading}
          onHoverCandidate={onHoverCandidate}
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
