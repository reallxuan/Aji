import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { catchingUp, shownCandidates, type ShownCandidate } from '../analysis/candidates';
import { CATCHING_UP_FADE_MS, CATCHING_UP_OPACITY } from '../analysis/constants';
import { formatLead, formatPercent, formatVisits } from '../analysis/format';
import { useViewStore } from '../analysis/viewStore';
import { moveLabel } from '../board/coordinates';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { RankChip } from './RankChip';

// Design 4.3: chip, point, win rate, lead, visits, against the best. The last column never
// wraps ("实战 −2.8%"): in a 360 px panel it takes its text's width and the numbers give way.
const COLUMNS =
  'grid grid-cols-[30px_62px_repeat(3,minmax(0,1fr))_minmax(max-content,1.3fr)] items-center gap-x-1.5 whitespace-nowrap';

/**
 * The candidate table (design 5.7): the same candidates as the discs, in the side to move's view.
 * Hovering a row previews its line, exactly as hovering its disc.
 */
export function CandidateTable() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const analysis = useEngineStore((s) => s.analysis);
  const rejected = useEngineStore((s) => s.rejected);
  const snapshot = useGameStore((s) => s.snapshot);
  const hidden = useViewStore((s) => s.hidden || s.held);
  const hover = useViewStore((s) => s.hover);
  const setHover = useViewStore((s) => s.setHover);

  const current =
    analysis && snapshot && analysis.position === snapshot.positionKey ? analysis : null;
  const shown = current ? shownCandidates(current, snapshot!.nextColor, snapshot!.nextMove) : [];
  const fading = current !== null && catchingUp(current);
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

  const against = (c: ShownCandidate) => {
    const diff = c.rank === 1 ? t('analysis.best') : formatPercent(-c.loss / 100, lang, true);
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
      <div className="mb-1.5 flex justify-between text-[12.5px] text-text-muted">
        <span>{t('analysis.table.title')}</span>
        {total}
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
              className={`${COLUMNS} sticky top-0 border-b border-hairline bg-panel px-1.5 pt-1 pb-1.5 text-xs text-text-muted`}
            >
              <span role="columnheader" />
              <span role="columnheader">{t('analysis.columns.move')}</span>
              <span role="columnheader" className="text-right">
                {t('analysis.columns.winrate')}
              </span>
              <span role="columnheader" className="text-right">
                {t('analysis.columns.scoreLead')}
              </span>
              <span role="columnheader" className="text-right">
                {t('analysis.columns.visits')}
              </span>
              <span role="columnheader" className="text-right">
                {t('analysis.columns.vsBest')}
              </span>
            </div>
            {shown.map((c) => {
              const highlighted = hover?.rank === c.rank;
              return (
                <div
                  key={c.rank}
                  role="row"
                  data-rank={c.rank}
                  data-highlighted={highlighted || undefined}
                  data-catching-up={fading || undefined}
                  style={rowStyle}
                  className={`${COLUMNS} rounded border-b border-divider-soft px-1.5 py-2 ${highlighted ? 'bg-divider-soft' : ''}`}
                  onMouseEnter={() => setHover({ rank: c.rank, source: 'table' })}
                  onMouseLeave={() => {
                    const now = useViewStore.getState().hover;
                    if (now?.source === 'table' && now.rank === c.rank) setHover(null);
                  }}
                >
                  <span role="cell">
                    <RankChip tier={c.tier} rank={c.rank} played={c.played} />
                  </span>
                  <span role="cell" className="font-medium">
                    {moveLabel(c.move, snapshot!.size, t)}
                  </span>
                  <span role="cell" className="text-right">
                    {formatPercent(c.winrate, lang)}
                  </span>
                  <span role="cell" className="text-right text-score">
                    {formatLead(c.scoreLead, lang)}
                  </span>
                  <span role="cell" className="text-right text-text-muted">
                    {formatVisits(c.visits, lang)}
                  </span>
                  <span role="cell" className="text-right">
                    {against(c)}
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
