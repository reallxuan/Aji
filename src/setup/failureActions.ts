import type { JobOutcome } from '../transport/generated/JobOutcome';

export type FailedOutcome = Extract<JobOutcome, { outcome: 'failed' }>;
export type FailureAction = 'retry' | 'fallback' | 'back';

/**
 * The buttons of a failure panel (M5 design 5.3). The fallback is never the only way on when the
 * user can fix the cause: an old driver makes Retry the main button (A1). Otherwise an offer comes
 * first (A2), a declined licence offers only the fallback, and with no offer it is Retry or Back (B).
 */
export function failureActions(outcome: FailedOutcome): {
  primary: FailureAction;
  secondary: FailureAction | null;
} {
  const offer = outcome.offer !== null;
  if (outcome.failure === 'licenceNotAccepted') {
    return offer ? { primary: 'fallback', secondary: null } : { primary: 'back', secondary: null };
  }
  if (outcome.failure === 'gpuDriverTooOld') {
    return { primary: 'retry', secondary: offer ? 'fallback' : 'back' };
  }
  return offer
    ? { primary: 'fallback', secondary: 'retry' }
    : { primary: 'retry', secondary: 'back' };
}
