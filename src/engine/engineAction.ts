import { jobActive } from '../job/jobStore';
import { useWizardStore } from '../setup/wizardStore';
import { continueAnalysis, pauseAnalysis, resumeAnalysis } from '../transport/api';
import type { EngineState } from '../transport/generated/EngineState';
import type { JobProgress } from '../transport/generated/JobProgress';
import type { Transport } from '../transport/transport';

export type EngineAction = 'pause' | 'resume' | 'continue' | 'setUp';

/**
 * What a click on the indicator (or Space) does in `state`. While a whole-game job searches it
 * pauses, even at the board's visit limit: the engine is busy with the job (design 5.3).
 */
export function engineAction(
  state: EngineState | null,
  job: JobProgress | null,
): EngineAction | null {
  if (jobActive(job) && (state?.state === 'analysing' || state?.state === 'ready')) {
    return 'pause';
  }
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
