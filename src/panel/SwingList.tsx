import { useState } from 'react';
import { cn } from 'cn';
import { Trans, useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatLead, formatPercent } from '../analysis/format';
import { coverage, swings, type SwingBy, type SwingRow } from '../analysis/swings';
import { currentTrendLine, useTrendStore } from '../analysis/trendStore';
import { moveLabel } from '../board/coordinates';
import { useDeviceStore } from '../device/deviceStore';
import { navigate } from '../game/actions';
import { useGameStore } from '../game/gameStore';
import { useActionContext } from '../game/useActionContext';
import type { Color } from '../transport/generated/Color';

const BY: SwingBy[] = ['winrate', 'score'];
const SIDES: Color[] = ['black', 'white'];
const ROW = 'grid grid-cols-[2.75rem_2.75rem_1fr_1fr] items-center gap-x-1 whitespace-nowrap';
const DISC: Record<Color, string> = { black: 'bg-bar-black', white: 'bg-bar-white' };

/**
 * 波动 (P2 M2 design 5.4, lists mockup sections 3–4): each side's moves that lost more than the
 * threshold, biggest first, by win rate or score, optionally only after the current move. A click
 * goes to the position before the move, where the board shows what KataGo preferred.
 */
export function SwingList() {
  const { t } = useTranslation();
  const nodes = useTrendStore((s) => s.nodes);
  const lineIndex = useGameStore((s) => s.snapshot?.lineIndex ?? 0);
  const by = useDeviceStore((s) => s.settings.swingBy);
  const thresholds = useDeviceStore((s) => s.settings.swingThreshold);
  const afterOnly = useDeviceStore((s) => s.settings.swingAfterOnly);
  const update = useDeviceStore((s) => s.update);

  const lists = swings(nodes, by, thresholds[by], afterOnly ? lineIndex : null);
  const comparable = nodes.some((n) => n.loss);
  const { analysed, total } = coverage(nodes);

  return (
    <section className="flex min-h-0 flex-1 flex-col text-sm">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-6 pt-3 pb-2 text-[0.78125rem] text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          {t('swings.by')}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={t('swings.by')}
            value={by}
            onValueChange={(next) => next && update({ swingBy: next as SwingBy })}
          >
            {BY.map((option) => (
              <ToggleGroupItem key={option} value={option} className="h-6 px-2.5">
                {t(`swings.${option}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </span>
        <span className="inline-flex items-center gap-1">
          <Trans
            i18nKey={by === 'winrate' ? 'swings.overWinrate' : 'swings.overScore'}
            components={{
              field: (
                <Threshold
                  // A fresh field for each measure: each keeps its own threshold.
                  key={by}
                  label={t('swings.threshold')}
                  value={thresholds[by]}
                  onChange={(value) => update({ swingThreshold: { ...thresholds, [by]: value } })}
                />
              ),
            }}
          />
        </span>
        <label className="inline-flex items-center gap-1.5">
          <Checkbox
            // The mockup's stronger edge: the shared one is faint on the panel unchecked.
            className="border-line"
            aria-label={t('swings.afterOnly')}
            checked={afterOnly}
            onCheckedChange={(checked) => update({ swingAfterOnly: checked === true })}
          />
          {t('swings.afterOnly')}
        </label>
      </div>
      {comparable ? (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-5 overflow-y-auto px-6 pb-3">
            {SIDES.map((color) => (
              <Side key={color} color={color} rows={lists[color]} current={lineIndex} />
            ))}
          </div>
          {analysed < total && (
            <p className="border-t border-hairline px-6 pt-2 pb-3 text-xs text-text-muted">
              {t('swings.partial', { count: analysed })}
            </p>
          )}
        </>
      ) : (
        <div className="px-10 py-10 text-center text-[0.8125rem] leading-relaxed text-text-muted">
          <p className="font-medium text-text">{t('swings.empty.title')}</p>
          <p>{t('swings.empty.body')}</p>
        </div>
      )}
    </section>
  );
}

/** One side's list: its name and count, a header row, then a row per swing. */
function Side({ color, rows, current }: { color: Color; rows: SwingRow[]; current: number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const ctx = useActionContext();
  const size = useGameStore((s) => s.snapshot?.size ?? 19);
  const nodes = useTrendStore((s) => s.nodes);
  const revision = useTrendStore((s) => s.lineRevision);
  const name = t(`swings.${color}`);
  // The position before the move: KataGo's candidates there, the move played among them.
  const before = (row: SwingRow) => {
    const parent = nodes[row.lineIndex - 1];
    if (parent && currentTrendLine(revision)) void navigate(ctx, { node: parent.node });
  };

  return (
    <section role="region" aria-label={name} className="min-w-0 tabular-nums">
      <h4 className="mt-1.5 mb-0.5 flex items-center gap-[7px] text-[0.78125rem] font-medium">
        <span className={cn('size-[11px] rounded-full ring-1 ring-line ring-inset', DISC[color])} />
        {name}
        <span className="font-normal text-text-muted">
          {t('swings.count', { count: rows.length })}
        </span>
      </h4>
      <div className={cn(ROW, 'border-b border-hairline py-1.5 text-[0.71875rem] text-text-muted')}>
        <span>{t('swings.columns.move')}</span>
        <span>{t('swings.columns.point')}</span>
        <span className="text-right">{t('swings.columns.winrate')}</span>
        <span className="text-right">{t('swings.columns.score')}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-1.5 text-[0.8125rem] text-text-muted">{t('swings.none')}</p>
      ) : (
        rows.map((row) => {
          const here = row.lineIndex === current;
          return (
            <button
              key={row.lineIndex}
              type="button"
              data-swing-row={row.moveNumber}
              data-current={here || undefined}
              onClick={() => before(row)}
              className={cn(
                ROW,
                'w-full rounded border-b border-divider-soft py-1.5 text-left text-[0.8125rem] hover:bg-divider-soft',
                here && 'bg-divider-soft',
              )}
            >
              <span className="text-text-muted">{row.moveNumber}</span>
              <span>{row.move ? moveLabel(row.move, size, t) : ''}</span>
              <span className="text-right">
                {formatPercent(-row.loss.winrate / 100, lang, true)}
              </span>
              <span className="text-right text-score">{formatLead(-row.loss.score, lang)}</span>
            </button>
          );
        })
      )}
    </section>
  );
}

/** The threshold: a short number field, saved while it reads as a positive number. */
function Threshold({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className="h-6 w-11 rounded-md border border-hairline bg-transparent px-1.5 text-center text-[0.78125rem] text-text tabular-nums outline-none focus-visible:border-text-muted"
      value={text}
      maxLength={5}
      onChange={(event) => {
        const next = event.target.value.replace(/[^\d.]/g, '');
        setText(next);
        const n = Number(next);
        if (next !== '' && Number.isFinite(n) && n > 0) onChange(n);
      }}
    />
  );
}
