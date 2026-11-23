import { useRef } from 'react';
import { cn } from 'cn';
import { useRowLineWheel } from '../board/useWheelNavigation';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { moveKey, sameMove, type ShownCandidate } from '../analysis/candidates';
import { CATCHING_UP_FADE_MS, CATCHING_UP_OPACITY } from '../analysis/constants';
import { formatLead, formatPercent, formatVisits } from '../analysis/format';
import { nextSort, sortCandidates } from '../analysis/sortCandidates';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { shownLength } from '../analysis/variation';
import { useViewStore } from '../analysis/viewStore';
import { moveLabel } from '../board/coordinates';
import { useDeviceStore } from '../device/deviceStore';
import type { CandidateColumns } from '../device/deviceSettings';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { usePanelWidth } from '../layout/usePanelWidth';
import { CandidateColumnsMenu } from './CandidateColumnsMenu';
import { EyeButton } from './EyeButton';
import { RankChip } from './RankChip';

const GRID = 'grid items-center gap-x-1.5 whitespace-nowrap';
// A panel narrower than this keeps the chip, point, win rate and lead, as the P2 M1 layouts
// mockup draws Classic's and Minimal's columns; more columns would run into each other there.
const FULL_WIDTH = 360;

type Column = 'winrate' | 'scoreLead' | 'visits' | 'vsBest';
const ALL: Column[] = ['winrate', 'scoreLead', 'visits', 'vsBest'];
const NARROW: Column[] = ['winrate', 'scoreLead'];
const SORTED_DOWN = '▼';
const SORTED_UP = '▲';

/**
 * Design 4.3's grid, less the columns turned off: chip, point, then each column. 与最佳相比 never
 * wraps ("实战 −2.8%"): it takes its text's width and the numbers give way. The visits cell is a
 * little wider when it holds the share.
 */
function template(columns: Column[], share: boolean): string {
  const width = (c: Column) =>
    c === 'vsBest'
      ? 'minmax(max-content,1.3fr)'
      : c === 'visits' && share
        ? 'minmax(0,1.25fr)'
        : 'minmax(0,1fr)';
  return ['30px', '62px', ...columns.map(width)].join(' ');
}

/**
 * The candidate table (design 5.7): the same candidates as the discs, in the side to move's view.
 * Hovering a row previews its line, exactly as hovering its disc. A header click sorts by that
 * column, and a right-click on the header row chooses the columns (P2 M2 design 5.5).
 */
export function CandidateTable({ maxRows }: { maxRows?: number } = {}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { current, shown: all, fading } = useShownCandidates();
  const sort = useDeviceStore((s) => s.settings.candidateSort);
  const chosen = useDeviceStore((s) => s.settings.candidateColumns);
  const sortedRows = sortCandidates(all, sort.key, sort.descending);
  const shown = maxRows === undefined ? sortedRows : sortedRows.slice(0, maxRows);
  const rejected = useEngineStore((s) => s.rejected);
  const snapshot = useGameStore((s) => s.snapshot);
  const hidden = useViewStore((s) => s.hidden || s.held);
  const hover = useViewStore((s) => s.hover);
  const setHover = useViewStore((s) => s.setHover);
  const variation = useViewStore((s) => s.variation);
  const step = useViewStore((s) => s.step);
  const width = usePanelWidth();
  const table = useRef<HTMLDivElement>(null);
  useRowLineWheel(table);
  const narrow = width > 0 && width < FULL_WIDTH;
  const visible = (narrow ? NARROW : ALL).filter((c) => chosen[c as keyof CandidateColumns]);
  const share = chosen.share && visible.includes('visits');
  const grid = { gridTemplateColumns: template(visible, share) };
  // Without 与最佳相比, the move played gets a 实战 tag beside its point.
  const tagPlayed = !visible.includes('vsBest');
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
  const bestWinrate = all[0]?.winrate ?? 0;
  const rootVisits = current?.rootVisits ?? 0;
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
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[0.78125rem] text-text-muted">
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
          <div ref={table} role="table" className="min-h-0 overflow-y-auto tabular-nums">
            <CandidateColumnsMenu>
              <div
                role="row"
                style={grid}
                className={`${GRID} sticky top-0 border-b border-hairline bg-panel px-1.5 pt-1 pb-1.5 text-xs text-text-muted`}
              >
                <span role="columnheader" />
                <span role="columnheader">{t('analysis.columns.move')}</span>
                {visible.map((column) => {
                  if (column === 'vsBest')
                    return (
                      <span key={column} role="columnheader" className="text-right">
                        {t('analysis.columns.vsBest')}
                      </span>
                    );
                  const active = sort.key === column;
                  return (
                    <span
                      key={column}
                      role="columnheader"
                      aria-sort={
                        active ? (sort.descending ? 'descending' : 'ascending') : undefined
                      }
                      className="text-right"
                    >
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-1 hover:text-text',
                          active && 'font-medium text-text',
                        )}
                        onClick={() =>
                          useDeviceStore
                            .getState()
                            .update({ candidateSort: nextSort(sort, column) })
                        }
                      >
                        {t(`analysis.columns.${column}`)}
                        {active && (
                          <span aria-hidden className="text-[0.5625rem]">
                            {sort.descending ? SORTED_DOWN : SORTED_UP}
                          </span>
                        )}
                      </button>
                    </span>
                  );
                })}
              </div>
            </CandidateColumnsMenu>
            {shown.map((c) => {
              const highlighted = !!hover && sameMove(hover.move, c.move);
              return (
                <div
                  key={moveKey(c.move)}
                  role="row"
                  data-rank={c.rank}
                  data-highlighted={highlighted || undefined}
                  data-catching-up={fading || undefined}
                  style={{ ...rowStyle, ...grid }}
                  className={`${GRID} rounded border-b border-divider-soft px-1.5 py-2 ${highlighted ? 'bg-divider-soft' : ''}`}
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
                    {tagPlayed && c.played && (
                      <span className="ml-1.5 rounded border border-hairline px-1 text-[0.6875rem] font-normal text-text-muted">
                        {t('analysis.table.playedTag')}
                      </span>
                    )}
                    {highlighted && stepped && (
                      <span className="ml-1.5 text-xs font-normal text-text-muted">{stepped}</span>
                    )}
                  </span>
                  {visible.map((column) => {
                    switch (column) {
                      case 'winrate':
                        return (
                          <span key={column} role="cell" className="text-right">
                            {formatPercent(c.winrate, lang)}
                          </span>
                        );
                      case 'scoreLead':
                        return (
                          <span key={column} role="cell" className="text-right text-score">
                            {formatLead(c.scoreLead, lang)}
                          </span>
                        );
                      case 'visits': {
                        const percent =
                          rootVisits > 0 ? Math.round((c.visits / rootVisits) * 100) : 0;
                        return (
                          <span key={column} role="cell" className="text-right text-text-muted">
                            {share ? (
                              <span className="relative inline-block min-w-[5.25rem]">
                                {formatVisits(c.visits, lang)}
                                <span className="ml-1.5 text-xs">
                                  {t('analysis.table.share', { share: percent })}
                                </span>
                                <span
                                  data-share-bar
                                  className="absolute right-0 -bottom-[3px] h-0.5 min-w-[3px] rounded-[1px] bg-text-muted opacity-55"
                                  style={{ width: `${percent}%` }}
                                />
                              </span>
                            ) : (
                              formatVisits(c.visits, lang)
                            )}
                          </span>
                        );
                      }
                      case 'vsBest':
                        return (
                          <span key={column} role="cell" className="text-right">
                            {against(c)}
                          </span>
                        );
                    }
                  })}
                </div>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
