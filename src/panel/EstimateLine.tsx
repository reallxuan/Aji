import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEstimateStore } from '../analysis/estimateStore';
import { formatPoints, isEvenLead } from '../analysis/format';
import { useTrendStore } from '../analysis/trendStore';
import { useEstimateSync } from '../analysis/useEstimateSync';
import { useEngineStoreApi } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { useScoringStore } from '../scoring/scoringStore';
import { useTransport } from '../transport/TransportProvider';

/**
 * The position estimate's line under the win-rate bar (P2 M2 design 5.7, mockup section 5):
 * 形势判断 黑 185 白 176 贴目 7.5 黑领先 1.5 目 ✕. Every point goes to the side KataGo leans to,
 * counted by the rules chip's scoring. At the last move of a finished game it offers 点目.
 */
export function EstimateLine() {
  const on = useEstimateStore((s) => s.on);
  // Off, nothing runs: no count is asked for.
  return on ? <ShownLine /> : null;
}

function ShownLine() {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const engine = useEngineStoreApi();
  const lang = i18n.language;
  const score = useEstimateStore((s) => s.score);
  const finished = useFinishedHere();
  useEstimateSync();

  const count = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const verdict = !score
    ? null
    : isEvenLead(score.margin)
      ? t('estimate.even')
      : t(score.margin > 0 ? 'estimate.blackLeads' : 'estimate.whiteLeads', {
          n: formatPoints(Math.abs(score.margin), lang),
        });

  return (
    <div
      data-testid="estimate-line"
      className="mx-6 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-hairline pt-2 pb-2.5 text-[0.8125rem] text-text-muted tabular-nums"
    >
      <span className="font-medium text-text">{t('estimate.title')}</span>
      {score ? (
        <>
          <span>{t('estimate.black', { n: count.format(score.black.total) })}</span>
          {/* White's total includes komi; the line shows it beside. */}
          <span>{t('estimate.white', { n: count.format(score.white.total - score.komi) })}</span>
          <span>{t('estimate.komi', { komi: count.format(score.komi) })}</span>
          <span className="ml-auto font-semibold text-text">{verdict}</span>
        </>
      ) : (
        <span className="mr-auto">{t('estimate.waiting')}</span>
      )}
      {finished && (
        <button
          type="button"
          className="rounded-[5px] border border-hairline px-2 py-px text-xs text-text hover:bg-divider-soft"
          onClick={() => void useScoringStore.getState().start({ transport, engine, t })}
        >
          {t('estimate.score')}
        </button>
      )}
      <button
        type="button"
        aria-label={t('estimate.close')}
        title={t('estimate.close')}
        className="rounded-[5px] border border-hairline px-1.5 py-[3px] text-text-muted hover:text-text"
        onClick={() => useEstimateStore.getState().toggle()}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

/** At the last move of a finished game: the record has a result, or ends in two passes. */
function useFinishedHere(): boolean {
  const atEnd = useGameStore((s) => s.snapshot?.atEnd ?? false);
  const result = useGameStore((s) => s.snapshot?.info.result ?? null);
  const twoPasses = useTrendStore((s) => {
    const [a, b] = [s.nodes.at(-2)?.move, s.nodes.at(-1)?.move];
    return a?.type === 'pass' && b?.type === 'pass';
  });
  return atEnd && (!!result || twoPasses);
}
