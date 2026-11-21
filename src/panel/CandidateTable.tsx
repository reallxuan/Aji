import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { moveKey, sameMove, type ShownCandidate } from '../analysis/candidates';
import { CATCHING_UP_FADE_MS, CATCHING_UP_OPACITY } from '../analysis/constants';
import { formatLead, formatPercent, formatVisits } from '../analysis/format';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { shownLength } from '../analysis/variation';
import { useViewStore } from '../analysis/viewStore';
import { moveLabel } from '../board/coordinates';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { usePanelWidth } from '../layout/usePanelWidth';
import { EyeButton } from './EyeButton';
import { RankChip } from './RankChip';

// Design 4.3: chip, point, win rate, lead, visits, against the best. The last column never
// wraps ("实战 −2.8%"): in a 360 px panel it takes its text's width and the numbers give way.
const COLUMNS =
  'grid grid-cols-[30px_62px_repeat(3,minmax(0,1fr))_minmax(max-content,1.3fr)] items-center gap-x-1.5 whitespace-nowrap';
// A panel narrower than this keeps the chip, point, win rate and lead, as the P2 M1 layouts
// mockup draws Classic's and Minimal's columns; six columns would run into each other there.
const FULL_WIDTH = 360;
const NARROW_COLUMNS =
  'grid grid-cols-[30px_62px_repeat(2,minmax(0,1fr))] items-center gap-x-1.5 whitespace-nowrap';

/**
 * The candidate table (design 5.7): the same candidates as the discs, in the side to move's view.
 * Hovering a row previews its line, exactly as hovering its disc.
 */
export function CandidateTable({ maxRows }: { maxRows?: number } = {}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { current, shown: all, fading } = useShownCandidates();
  const shown = maxRows === undefined ? all : all.slice(0, maxRows);
  const rejected = useEngineStore((s) => s.rejected);
  const snapshot = useGameStore((s) => s.snapshot);
  const hidden = useViewStore((s) => s.hidden || s.held);
  const hover = useViewStore((s) => s.hover);
  const setHover = useViewStore((s) => s.setHover);
  const variation = useViewStore((s) => s.variation);
  const step = useViewStore((s) => s.step);
  const width = usePanelWidth();
  const narrow = width > 0 && width < FULL_WIDTH;
  const columns = narrow ? NARROW_COLUMNS : COLUMNS;
  const length = variation ? shownLength(variation) : 0;
  // The wheel has stepped the hovered line short of its end: "3 / 8" beside the point.
  const stepped = variation && step !== null && step < length ? `${step} / ${length}` : null;

  const grouped = new Intl.NumberFormat(lang);

  const total = hidden ? (
    <span>{t('analysis.table.hidden')}</span>
  ) : current && !rejected ? (
    <span className="tabular-nums">
      {fading
        ? t('analysis.table.catchingUp', {
            visits: grouped.format(current.rootVisits),
            previous: grouped.format(current.previousVisits),
          })
        : t('analysis.table.total', { visits: formatVisits(current.rootVisits, lang) })}
    </span>
  ) : null;

  // The difference of the win rates shown, so it reads with the 胜率 column (design 13.1).
  const bestWinrate = shown[0]?.winrate ?? 0;
  const against = (c: ShownCandidate) => {
    const diff =
      c.rank === 1 ? t('analysis.best') : formatPercent(c.winrate - bestWinrate, lang, true);
    if (!c.played) return <span className={c.rank === 1 ? 'font-semibold' : ''}>{diff}</span>;
    return (
      <span className="font-semibold">
        {c.rank === 1 ? t('analysis.playedBest') : t('analysis.played', { diff })}
      </span>
    );
  };

  const rowStyle: CSSProperties = {
    opacity: fading ? CATCHING_UP_OPACITY : 1,
    transition: `opacity ${CATCHING_UP_FADE_MS}ms`,
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col px-6 pt-3 pb-2 text-sm">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[12.5px] text-text-muted">
        <span>{t('analysis.table.title')}</span>
        <span className="flex items-center gap-3">
          {total}
          <EyeButton />
        </span>
      </div>
      {rejected ? (
        <p className="text-text-muted" title={rejected.message}>
          {t('analysis.table.rejected')}
        </p>
      ) : (
        !hidden &&
        shown.length > 0 && (
          <div role="table" className="min-h-0 overflow-y-auto tabular-nums">
            <div
              role="row"
              className={`${columns} sticky top-0 border-b border-hairline bg-panel px-1.5 pt-1 pb-1.5 text-xs text-text-muted`}
            >
              <span role="columnheader" />
              <span role="columnheader">{t('analysis.columns.move')}</span>
              <span role="columnheader" className="text-right">
                {t('analysis.columns.winrate')}
              </span>
              <span role="columnheader" className="text-right">
                {t('analysis.columns.scoreLead')}
              </span>
              {!narrow && (
                <>
                  <span role="columnheader" className="text-right">
                    {t('analysis.columns.visits')}
                  </span>
                  <span role="columnheader" className="text-right">
                    {t('analysis.columns.vsBest')}
                  </span>
                </>
              )}
            </div>
            {shown.map((c) => {
              const highlighted = !!hover && sameMove(hover.move, c.move);
              return (
                <div
                  key={moveKey(c.move)}
                  role="row"
                  data-rank={c.rank}
                  data-highlighted={highlighted || undefined}
                  data-catching-up={fading || undefined}
                  style={rowStyle}
                  className={`${columns} rounded border-b border-divider-soft px-1.5 py-2 ${highlighted ? 'bg-divider-soft' : ''}`}
                  onMouseEnter={() => setHover({ move: c.move, source: 'table' })}
                  onMouseLeave={() => {
                    const now = useViewStore.getState().hover;
                    if (now?.source === 'table' && sameMove(now.move, c.move)) setHover(null);
                  }}
                >
                  <span role="cell">
                    <RankChip tier={c.tier} rank={c.rank} played={c.played} />
                  </span>
                  <span role="cell" className="font-medium">
                    {moveLabel(c.move, snapshot!.size, t)}
                    {highlighted && stepped && (
                      <span className="ml-1.5 text-xs font-normal text-text-muted">{stepped}</span>
                    )}
                  </span>
                  <span role="cell" className="text-right">
                    {formatPercent(c.winrate, lang)}
                  </span>
                  <span role="cell" className="text-right text-score">
                    {formatLead(c.scoreLead, lang)}
                  </span>
                  {!narrow && (
                    <>
                      <span role="cell" className="text-right text-text-muted">
                        {formatVisits(c.visits, lang)}
                      </span>
                      <span role="cell" className="text-right">
                        {against(c)}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
