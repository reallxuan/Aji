import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { useWizardStore } from '../setup/wizardStore';
import { restartEngine } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';

const setUpAgain = () => useWizardStore.getState().openWizard(true);

/**
 * The status line under the header: shown for every state except analysing and paused, and in
 * any running state on a node whose move breaks the rules, which KataGo does not analyse.
 */
export function EngineStatus() {
  const transport = useTransport();
  const { t } = useTranslation();
  const engine = useEngineStore((s) => s.engine);
  const illegal = useGameStore((s) => s.snapshot?.illegal ?? null);
  const running =
    engine?.state === 'ready' || engine?.state === 'analysing' || engine?.state === 'paused';
  if (illegal && running) {
    return (
      <div className="px-6 py-3 text-sm text-text-muted">
        <p>{t('engine.illegal', { reason: t(`engine.illegalReason.${illegal}`) })}</p>
      </div>
    );
  }
  if (!engine || engine.state === 'analysing' || engine.state === 'paused') return null;
  // Stopped at the visit limit: the engine dot and its card say so (design 5.2).
  if (engine.state === 'ready' && engine.limitReached) return null;

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
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={setUpAgain}>
              {t('engine.action.setupAgain')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                restartEngine(transport).catch(() => undefined);
              }}
            >
              {t('engine.action.restart')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
