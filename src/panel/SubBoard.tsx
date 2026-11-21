import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { moveKey, sameMove } from '../analysis/candidates';
import { formatLead, formatPercent } from '../analysis/format';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { useSubBoardLine } from '../analysis/useSubBoardLine';
import { shownLength, type Variation, variationBoard } from '../analysis/variation';
import { useViewStore } from '../analysis/viewStore';
import { BoardCanvas } from '../board/BoardCanvas';
import { moveLabel } from '../board/coordinates';
import { useBoardStyle } from '../board/useBoardStyle';
import { PIXELS_PER_MOVE } from '../board/useWheelNavigation';
import { useGameStore } from '../game/gameStore';
import { panelsOf } from '../layout/model';
import { useLayout } from '../layout/useLayout';
import { usePanelSize } from '../layout/usePanelWidth';
import { RankChip } from './RankChip';

/** The label row's height, and the room kept around the board. */
const LABEL = 34;
const PAD = 8;

/** The wheel over a sub-board steps its line, one move per notch or 50 px, never the game. */
function useLineWheel(
  ref: RefObject<HTMLElement | null>,
  step: number | null,
  length: number,
  setStep: (n: number) => void,
) {
  const latest = useRef({ step, length, setStep });
  useEffect(() => {
    latest.current = { step, length, setStep };
  });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let total = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      // The main board's wheel must not also see it.
      event.stopPropagation();
      if (event.deltaY === 0) return;
      if (Math.sign(event.deltaY) !== Math.sign(total)) total = 0;
      total +=
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
          ? event.deltaY
          : Math.sign(event.deltaY) * PIXELS_PER_MOVE;
      if (Math.abs(total) < PIXELS_PER_MOVE) return;
      const forward = total > 0;
      total = 0;
      const { step: now, length: end, setStep: set } = latest.current;
      if (now !== null) set(Math.min(end, Math.max(1, now + (forward ? 1 : -1))));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);
}

/**
 * A sub-board (P2 M1 design 5.6): the rank's candidate played out from the current position, as
 * numbered stones and no discs, under a label row (chip, point, win rate, lead). The wheel steps
 * the line. Clicking the label shows the line on the main board, as a hover does. In Thinking,
 * the first sub-board shows the hovered line instead, and the main board keeps its discs.
 */
export function SubBoard({ rank }: { rank: 1 | 2 | 3 }) {
  const { t, i18n } = useTranslation();
  const snapshot = useGameStore((s) => s.snapshot);
  const { shown } = useShownCandidates();
  const own = useSubBoardLine(rank);
  const { layout } = useLayout();
  // With one sub-board it always shows the best line, so its label needs no rank.
  const ranked = panelsOf(layout.root).filter((p) => p.kind === 'subboard').length > 1;
  const hover = useViewStore((s) => s.hover);
  const hoverLine = useViewStore((s) => s.variation);
  const hoverStep = useViewStore((s) => s.step);
  const style = useBoardStyle();
  const { width, height } = usePanelSize();
  const boardArea = useRef<HTMLDivElement>(null);

  // Thinking draws the hovered line here, not on the main board (design 5.2).
  const borrowed = rank === 1 && layout.lines === 'subboard' && hoverLine !== null;
  const line: Variation | null = borrowed ? hoverLine : own.line;
  const step = borrowed ? hoverStep : own.step;
  const setStep = borrowed ? useViewStore.getState().setStep : own.setStep;
  // F or Z hides the engine's answer, so the label names no point and no numbers (design 5.6).
  const hidden = useViewStore((s) => s.hidden || s.held);
  const candidate = hidden
    ? null
    : ((borrowed && hover ? shown.find((c) => sameMove(c.move, hover.move)) : null) ??
      shown.find((c) => c.rank === rank) ??
      null);
  useLineWheel(boardArea, step, line ? shownLength(line) : 0, setStep);

  const size = snapshot?.size ?? 19;
  const board = useMemo(
    () =>
      line && snapshot && step !== null ? variationBoard(snapshot.stones, size, line, step) : null,
    [line, snapshot, size, step],
  );
  const side = Math.max(0, Math.floor(Math.min(width - 2 * PAD, height - LABEL - PAD)));
  const lang = i18n.language;

  return (
    <div
      data-subboard={rank}
      data-step={step ?? undefined}
      data-line-move={line ? moveKey(line.moves[0]) : undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-none items-center px-3" style={{ height: LABEL }}>
        {hidden ? null : candidate ? (
          <button
            type="button"
            className="flex items-center gap-2 rounded-sm px-1 py-0.5 text-[12.5px] tabular-nums hover:bg-divider-soft"
            onClick={() =>
              useViewStore.getState().setHover({ move: candidate.move, source: 'board' })
            }
          >
            {ranked && (
              <RankChip tier={candidate.tier} rank={candidate.rank} played={candidate.played} />
            )}
            <span className="font-medium">{moveLabel(candidate.move, size, t)}</span>
            <span>{formatPercent(candidate.winrate, lang)}</span>
            <span className="text-score">{formatLead(candidate.scoreLead, lang)}</span>
          </button>
        ) : (
          <span className="px-1 text-[12.5px] text-text-muted">{t('layout.noCandidate')}</span>
        )}
      </div>
      <div
        ref={boardArea}
        data-subboard-board
        className="flex min-h-0 flex-1 items-start justify-center"
      >
        {side > 0 && (
          <BoardCanvas
            cssSize={side}
            boardSize={size}
            stones={board?.stones ?? snapshot?.stones ?? []}
            lastMove={board ? null : (snapshot?.lastMove ?? null)}
            variation={board}
            coordinates={false}
            lang={lang}
            boardStyle={style.board}
            stoneStyle={style.stones}
          />
        )}
      </div>
    </div>
  );
}
