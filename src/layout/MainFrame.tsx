import type { ReactNode } from 'react';
import { computeFrame } from './frame';
import { useWindowSize } from './useWindowSize';

/** The main screen: a square board area on the left, one panel running the full height on the right. */
export function MainFrame({ panel }: { panel: ReactNode }) {
  const { width, height } = useWindowSize();
  const { board, panel: panelBox } = computeFrame(width, height);

  return (
    <div className="relative h-full w-full">
      {/* Placeholder for the board canvas, which arrives in M5. */}
      <div
        className="absolute bg-board-base"
        style={{ left: board.x, top: board.y, width: board.size, height: board.size }}
      />
      <aside
        className="absolute inset-y-0 flex flex-col border-l border-hairline bg-panel"
        style={{ left: panelBox.x, width: panelBox.width }}
      >
        {panel}
      </aside>
    </div>
  );
}
