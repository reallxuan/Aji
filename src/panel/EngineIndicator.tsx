import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../engine/engineStore';
import { useWizardStore } from '../setup/wizardStore';
import { pauseAnalysis, resumeAnalysis } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';

/** The 10 px round engine button in the panel header: colour shows the state, click pauses or resumes. */
export function EngineIndicator() {
  const transport = useTransport();
  const { t } = useTranslation();
  const engine = useEngineStore((s) => s.engine);
  const state = engine?.state ?? null;

  const stateText = state ? t(`engine.state.${state}`) : '';
  const action =
    state === 'analysing'
      ? 'pause'
      : state === 'paused'
        ? 'resume'
        : state === 'notConfigured'
          ? 'setUp'
          : null;
  const colour =
    state === 'analysing' ? 'bg-engine-ok' : state === 'crashed' ? 'bg-engine-error' : 'bg-line';

  const onClick = () => {
    if (action === 'setUp') {
      useWizardStore.getState().openWizard(false);
      return;
    }
    const run = action === 'pause' ? pauseAnalysis : resumeAnalysis;
    // A failure shows up as a state event; nothing to do here.
    run(transport).catch(() => undefined);
  };

  return (
    <button
      type="button"
      className={`size-2.5 flex-none rounded-full ${colour} disabled:cursor-default`}
      data-state={state ?? 'unknown'}
      aria-label={
        action === 'setUp' ? t('noEngine.setup') : action ? t(`engine.action.${action}`) : stateText
      }
      title={stateText}
      disabled={!action}
      onClick={onClick}
    />
  );
}
