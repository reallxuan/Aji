import { useTranslation } from 'react-i18next';
import { moveLabel } from '../board/coordinates';
import { useEngineStore } from '../engine/engineStore';

const MAX_ROWS = 10;

/** The top candidates of the latest analysis: move, Black win rate, Black lead and visits. */
export function CandidateList() {
  const { t, i18n } = useTranslation();
  const analysis = useEngineStore((s) => s.analysis);
  if (!analysis || analysis.candidates.length === 0) return null;

  const lang = i18n.language;
  const percent = new Intl.NumberFormat(lang, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const lead = new Intl.NumberFormat(lang, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  });
  const visits = new Intl.NumberFormat(lang, { useGrouping: true });

  return (
    <table className="w-full px-6 text-sm tabular-nums">
      <thead className="text-xs text-text-muted">
        <tr>
          <th className="px-3 py-1 text-left font-normal">{t('analysis.columns.move')}</th>
          <th className="px-3 py-1 text-right font-normal">{t('analysis.columns.winrate')}</th>
          <th className="px-3 py-1 text-right font-normal">{t('analysis.columns.scoreLead')}</th>
          <th className="px-3 py-1 text-right font-normal">{t('analysis.columns.visits')}</th>
        </tr>
      </thead>
      <tbody>
        {analysis.candidates.slice(0, MAX_ROWS).map((c) => (
          <tr key={c.order}>
            <td className="px-3 py-0.5">{moveLabel(c.move, analysis.boardSize, t)}</td>
            <td className="px-3 py-0.5 text-right">{percent.format(c.winrate)}</td>
            <td className="px-3 py-0.5 text-right text-score">{lead.format(c.scoreLead)}</td>
            <td className="px-3 py-0.5 text-right">{visits.format(c.visits)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
