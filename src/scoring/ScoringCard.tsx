import { cn } from 'cn';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatPoints } from '../analysis/format';
import { scoringOf } from '../game/komi';
import { useGameStore } from '../game/gameStore';
import type { Color } from '../transport/generated/Color';
import type { ScoreSide } from '../transport/generated/ScoreSide';
import type { ScoreView } from '../transport/generated/ScoreView';
import type { Scoring } from '../transport/generated/Scoring';
import { useTransport } from '../transport/TransportProvider';
import { useScoringStore } from './scoringStore';

type Column = 'stones' | 'land' | 'dead' | 'prisoners' | 'komi' | 'total';

/** Area counts stones and the points they surround; territory counts what is surrounded. */
const COLUMNS: Record<Scoring, Column[]> = {
  area: ['stones', 'land', 'komi', 'total'],
  territory: ['land', 'dead', 'prisoners', 'komi', 'total'],
};
const SIDES: Color[] = ['black', 'white'];
const DISC: Record<Color, string> = { black: 'bg-bar-black', white: 'bg-bar-white' };

/** One cell of a side's row; komi is White's alone. */
function cell(score: ScoreView, color: Color, column: Column): number | null {
  const side: ScoreSide = score[color];
  switch (column) {
    case 'stones':
      return side.stones;
    // The dead stones' points are the surrounding side's points under either scoring; under
    // territory scoring each dead stone also counts again, as a prisoner (死子).
    case 'land':
      return side.territory + side.dead;
    case 'dead':
      return side.dead;
    case 'prisoners':
      return side.prisoners;
    case 'komi':
      return color === 'white' ? score.komi : null;
    case 'total':
      return side.total;
  }
}

/**
 * 终局点目 (P2 M2 design 5.8, final-scoring mockup section 2): in place of the win-rate bar and
 * the graph while scoring, the count by the rules chip's scoring, who wins, and the way back.
 */
export function ScoringCard() {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const rules = useGameStore((s) => s.snapshot?.rules.current ?? null);
  const score = useScoringStore((s) => s.score);
  const failed = useScoringStore((s) => s.failed);
  // Subscribed to the marking, so the flag follows each toggle.
  const changed = useScoringStore((s) => s.dead && s.changed());
  const scoring = rules ? scoringOf(rules) : 'area';
  const count = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const columns = COLUMNS[scoring];

  const verdict = !score
    ? null
    : score.margin === 0
      ? t('scoring.draw')
      : t(score.margin > 0 ? 'scoring.blackWins' : 'scoring.whiteWins', {
          n: formatPoints(Math.abs(score.margin), i18n.language).replace(/\.0$/, ''),
        });

  return (
    <section data-testid="scoring-card" className="text-[0.8125rem]">
      <div className="border-b border-hairline px-6 pt-4 pb-[18px]">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('scoring.title')}</h3>
          {rules && (
            <span className="text-xs text-text-muted">
              {t('scoring.subtitle', {
                rules: t(`scoring.rules.${rules.kind}`),
                counting: t(`scoring.counting.${scoring}`),
              })}
            </span>
          )}
        </div>
        {score ? (
          <>
            <table className="w-full border-collapse tabular-nums">
              <thead>
                <tr className="text-xs text-text-muted">
                  <th className="pb-1.5 text-left font-normal">
                    {t(`scoring.columns.${scoring}`)}
                  </th>
                  {columns.map((column) => (
                    <th key={column} className="pb-1.5 text-right font-normal">
                      {t(`scoring.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SIDES.map((color) => (
                  <tr key={color} className="border-t border-divider-soft">
                    <td className="py-1.5">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'size-3 rounded-full ring-1 ring-line ring-inset',
                            DISC[color],
                          )}
                        />
                        {t(`scoring.${color}`)}
                      </span>
                    </td>
                    {columns.map((column) => {
                      const value = cell(score, color, column);
                      return (
                        <td
                          key={column}
                          className={cn(
                            'py-1.5 text-right',
                            column === 'total' && 'text-sm font-semibold',
                          )}
                        >
                          {value === null ? '' : count.format(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 flex items-center gap-2.5 text-lg font-semibold">
              {verdict}
              {changed && (
                <span className="rounded-full border border-score/50 px-2 py-px text-xs font-medium text-score">
                  {t('scoring.changed')}
                </span>
              )}
            </p>
            {score.openByOwnership && (
              <p className="mt-1 text-xs text-text">{t('scoring.openByOwnership')}</p>
            )}
            {failed && <p className="mt-1 text-xs text-engine-error">{t('scoring.failed')}</p>}
          </>
        ) : (
          <p className="text-text-muted">{t(failed ? 'scoring.failed' : 'scoring.waiting')}</p>
        )}
        <p className="mt-2.5 text-xs leading-relaxed text-text-muted">
          {/* The two sentences are apart in English; the gap is the same in Chinese. */}
          <span className="mr-1">{t('scoring.hint')}</span>
          {changed ? (
            <button
              type="button"
              className="text-text underline underline-offset-2"
              onClick={() => void useScoringStore.getState().reset(transport)}
            >
              {t('scoring.reset')}
            </button>
          ) : (
            t('scoring.fromKataGo')
          )}
        </p>
        <div className="mt-3.5 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void useScoringStore.getState().exit(transport)}
          >
            {t('scoring.exit')}
          </Button>
        </div>
      </div>
      <p className="px-6 py-3.5 text-text-muted">{t('scoring.rest')}</p>
    </section>
  );
}
