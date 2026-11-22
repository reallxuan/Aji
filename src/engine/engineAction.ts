import { useWizardStore } from '../setup/wizardStore';
import { continueAnalysis, pauseAnalysis, resumeAnalysis } from '../transport/api';
import type { EngineState } from '../transport/generated/EngineState';
import type { Transport } from '../transport/transport';

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
export function runEngineAction(action: EngineAction | null, transport: Transport): void {
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
