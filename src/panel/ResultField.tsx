import { useTranslation } from 'react-i18next';
import { readPendingRules, usePendingField, writeRootField } from '../game/fieldWrites';
import { sameRulesEffect } from '../game/komi';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import { useGameStore } from '../game/gameStore';
import { scoreOrigin, useScoringStore } from '../scoring/scoringStore';
import { useTransport } from '../transport/TransportProvider';
import { DECIMAL_INPUT_MODE, DraftInput, type RegisterEditor } from './DraftInput';

const WINNERS = ['none', 'black', 'white', 'draw'] as const;
const METHODS = ['points', 'resign', 'time', 'forfeit'] as const;
const RAW = 'raw';
type Winner = (typeof WINNERS)[number];
type Method = 'resign' | 'time' | 'forfeit';
type Result = { winner: Winner; by: { points: number } | Method | null } | { raw: string };
const methods = { resign: 'R', time: 'T', forfeit: 'F' } as const;
const decimal = /^\d+(?:\.\d+)?$/;

export function parseResult(re: string | null): Result {
  if (re === null) return { winner: 'none', by: null };
  if (re === '0') return { winner: 'draw', by: null };
  const match = /^([BW])\+(.+)$/.exec(re);
  if (match) {
    const [, color, tail] = match;
    const winner = color === 'B' ? 'black' : 'white';
    for (const method of Object.keys(methods) as Method[])
      if (methods[method] === tail) return { winner, by: method };
    if (decimal.test(tail) && Number.isFinite(Number(tail)))
      return { winner, by: { points: Number(tail) } };
  }
  return { raw: re };
}

export function formatResult(result: Result): string | null {
  if ('raw' in result) return result.raw;
  if (result.winner === 'draw') return '0';
  if (result.winner === 'none' || result.by === null) return null;
  const by = typeof result.by === 'string' ? methods[result.by] : result.by.points;
  return `${result.winner === 'black' ? 'B' : 'W'}+${by}`;
}

function countMatches(
  snapshot: GameSnapshot | null,
  origin: string,
  pending: AnalysisRules | null | undefined,
) {
  return (
    snapshot !== null &&
    scoreOrigin(snapshot) === origin &&
    (pending === undefined ||
      sameRulesEffect(snapshot.rules.current, pending ?? snapshot.rules.fromFile))
  );
}

export function FillScoreButton() {
  const { t } = useTranslation();
  const transport = useTransport();
  const snapshot = useGameStore((s) => s.snapshot);
  const pending = usePendingField(transport, 'rules');
  const count = useScoringStore((s) => s.lastCount);
  if (!snapshot || !count || !countMatches(snapshot, count.origin, pending?.value)) return null;
  const { margin } = count;
  const re =
    margin === 0
      ? '0'
      : formatResult({ winner: margin > 0 ? 'black' : 'white', by: { points: Math.abs(margin) } });
  const verdict =
    margin === 0
      ? t('scoring.draw')
      : t(margin > 0 ? 'scoring.blackWins' : 'scoring.whiteWins', { n: Math.abs(margin) });
  return (
    <button
      type="button"
      className="text-xs text-text underline underline-offset-2"
      onClick={() => {
        void writeRootField(
          { transport, t },
          snapshot.gameRevision,
          {
            kind: 'setInfo',
            field: 'result',
            value: re,
          },
          () =>
            useScoringStore.getState().lastCount === count &&
            countMatches(
              useGameStore.getState().snapshot,
              count.origin,
              readPendingRules(transport),
            ),
        );
      }}
    >
      {t('gameInfo.fillScore', { verdict })}
    </button>
  );
}

export const infoInputClass =
  'min-w-0 rounded border border-hairline bg-panel px-2 py-1 text-sm focus-visible:outline-ring';

export function ResultField({
  value,
  onChange,
  register,
}: {
  value: string | null;
  onChange(value: string | null): void;
  register: RegisterEditor;
}) {
  const { t } = useTranslation();
  const parsed = parseResult(value);
  const winner = 'winner' in parsed ? parsed.winner : 'raw';
  const by = 'by' in parsed ? parsed.by : null;
  const method = typeof by === 'string' ? by : 'points';
  function selectWinner(next: Winner) {
    onChange(formatResult({ winner: next, by: by ?? 'resign' }));
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className={infoInputClass}
          aria-label={t('gameInfo.result')}
          value={winner}
          onChange={(e) => selectWinner(e.target.value as Winner)}
        >
          {'raw' in parsed && <option value={RAW}>{parsed.raw}</option>}
          {WINNERS.map((w) => (
            <option key={w} value={w}>
              {t(`gameInfo.winners.${w}`)}
            </option>
          ))}
        </select>
        {(winner === 'black' || winner === 'white') && (
          <>
            <select
              aria-label={t('gameInfo.method')}
              className={infoInputClass}
              value={method}
              onChange={(e) =>
                onChange(
                  formatResult({
                    winner,
                    by: e.target.value === 'points' ? { points: 0.5 } : (e.target.value as Method),
                  }),
                )
              }
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`gameInfo.methods.${m}`)}
                </option>
              ))}
            </select>
            {typeof by === 'object' && by && (
              <DraftInput
                className={infoInputClass + ' w-16'}
                aria-label={t('gameInfo.margin')}
                register={register}
                value={String(by.points)}
                inputMode={DECIMAL_INPUT_MODE}
                onCommit={(text) => {
                  if (decimal.test(text.trim()) && Number.isFinite(Number(text)))
                    onChange(formatResult({ winner, by: { points: Number(text) } }));
                }}
              />
            )}
          </>
        )}
      </div>
      <FillScoreButton />
    </>
  );
}
