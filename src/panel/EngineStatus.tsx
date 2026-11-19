import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../engine/engineStore';
import { restartEngine } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';

/** The status line under the header: shown for every state except analysing and paused. */
export function EngineStatus() {
  const transport = useTransport();
  const { t } = useTranslation();
  const engine = useEngineStore((s) => s.engine);
  if (!engine || engine.state === 'analysing' || engine.state === 'paused') return null;

  const crashed = engine.state === 'crashed' ? engine : null;
  const exit = crashed?.exit ?? null;
  const exitLine = exit
    ? exit.code !== null
      ? t('engine.crash.exitCode', { code: exit.code })
      : exit.signal !== null
        ? t('engine.crash.signal', { signal: exit.signal })
        : null
    : null;

  return (
    <div className="px-6 py-3 text-sm text-text-muted">
      <p>{t(`engine.state.${engine.state}`)}</p>
      {crashed && (
        <>
          <p>{t(`engine.crash.${crashed.reason}`)}</p>
          {exitLine && <p>{exitLine}</p>}
          {crashed.stderrTail.length > 0 && (
            <>
              <p className="mt-2 text-xs">{t('engine.crash.details')}</p>
              <pre className="mt-1 max-h-40 overflow-auto text-xs">
                {crashed.stderrTail.join('\n')}
              </pre>
            </>
          )}
          <button
            type="button"
            className="mt-2 rounded border border-hairline px-3 py-1 text-text"
            onClick={() => {
              restartEngine(transport).catch(() => undefined);
            }}
          >
            {t('engine.action.restart')}
          </button>
        </>
      )}
    </div>
  );
}
