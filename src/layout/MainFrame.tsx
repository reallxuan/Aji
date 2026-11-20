import type { ReactNode } from 'react';
import { BoardCanvas } from '../board/BoardCanvas';
import { useGameStore } from '../game/gameStore';
import { computeFrame } from './frame';
import { useWindowSize } from './useWindowSize';

/** An empty 19×19 board, until the first game snapshot arrives. */
const EMPTY_19 = Array.from({ length: 19 * 19 }, () => null);

/** The main screen: a square board area on the left, one panel running the full height on the right. */
export function MainFrame({ panel }: { panel: ReactNode }) {
  const { width, height } = useWindowSize();
  const { board, panel: panelBox } = computeFrame(width, height);
  const snapshot = useGameStore((s) => s.snapshot);

  return (
    <div className="relative h-full w-full">
      <div className="absolute" style={{ left: board.x, top: board.y }}>
        <BoardCanvas
          cssSize={board.size}
          boardSize={snapshot?.size ?? 19}
          stones={snapshot?.stones ?? EMPTY_19}
          lastMove={snapshot?.lastMove ?? null}
        />
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
