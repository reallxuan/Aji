import { useTranslation } from 'react-i18next';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { HOVER_CARD_DELAY_MS } from '../analysis/constants';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { useWizardStore } from '../setup/wizardStore';
import { continueAnalysis, pauseAnalysis, resumeAnalysis } from '../transport/api';
import type { EngineState } from '../transport/generated/EngineState';
import { useTransport } from '../transport/TransportProvider';
import { EngineCard } from './EngineCard';

export type EngineAction = 'pause' | 'resume' | 'continue' | 'setUp';

/** What a click on the indicator (or Space) does in `state`. */
export function engineAction(state: EngineState | null): EngineAction | null {
  switch (state?.state) {
    case 'analysing':
      return 'pause';
    case 'paused':
      return 'resume';
    case 'ready':
      return state.limitReached ? 'continue' : null;
    case 'notConfigured':
      return 'setUp';
    default:
      return null;
  }
}

/** Runs `action` against the engine; a failure shows up as a state event. */
export function runEngineAction(
  action: EngineAction | null,
  transport: ReturnType<typeof useTransport>,
): void {
  if (action === 'setUp') {
    useWizardStore.getState().openWizard(false);
    return;
  }
  const run =
    action === 'pause'
      ? pauseAnalysis
      : action === 'resume'
        ? resumeAnalysis
        : action === 'continue'
          ? continueAnalysis
          : null;
  run?.(transport).catch(() => undefined);
}

/**
 * The 10 px round engine button in the panel header: colour shows the state, a hollow ring that
 * the position stopped at its visit limit. Click pauses, resumes or searches further; hovering
 * opens the engine card.
 */
export function EngineIndicator() {
  const transport = useTransport();
  const { t } = useTranslation();
  const engine = useEngineStore((s) => s.engine);
  const state = engine?.state ?? null;
  // On an illegal node KataGo has no position: the dot greys out, whatever the state.
  const illegal = useGameStore((s) => s.snapshot?.illegal ?? null);

  const atLimit = engine?.state === 'ready' && engine.limitReached && !illegal;
  const stateText = atLimit ? t('engine.limitReached') : state ? t(`engine.state.${state}`) : '';
  const action = engineAction(engine);
  const colour =
    state === 'crashed'
      ? 'bg-engine-error'
      : atLimit
        ? 'bg-transparent ring-2 ring-engine-ok ring-inset'
        : state === 'analysing' && !illegal
          ? 'bg-engine-ok'
          : 'bg-line';

  return (
    <HoverCard openDelay={HOVER_CARD_DELAY_MS} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={`size-2.5 flex-none rounded-full ${colour} disabled:cursor-default`}
          data-state={atLimit ? 'limitReached' : (state ?? 'unknown')}
          aria-label={
            action === 'setUp'
              ? t('noEngine.setup')
              : action
                ? t(`engine.action.${action}`)
                : stateText
          }
          disabled={!action}
          onClick={() => runEngineAction(action, transport)}
        />
      </HoverCardTrigger>
      {engine && engine.state !== 'notConfigured' && (
        <HoverCardContent
          align="end"
          className="w-auto rounded-lg border-hairline bg-pop px-3.5 py-3 text-text"
        >
          <EngineCard />
        </HoverCardContent>
      )}
    </HoverCard>
  );
}
