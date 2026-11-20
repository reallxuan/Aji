import { describe, expect, it } from 'vitest';
import type { FailureCode } from '../transport/generated/FailureCode';
import type { FallbackOffer } from '../transport/generated/FallbackOffer';
import { failureActions } from './failureActions';

const offer: FallbackOffer = {
  backend: 'directml',
  engine: 'e',
  downloadBytes: 1,
  runtimeBytes: null,
};
const failed = (failure: FailureCode, withOffer: boolean) => ({
  outcome: 'failed' as const,
  failure,
  stderrTail: [],
  offer: withOffer ? offer : null,
  driver: null,
});

describe('failureActions (M5 design 5.3)', () => {
  it('A1: an old driver makes Retry the main button, the fallback second', () => {
    expect(failureActions(failed('gpuDriverTooOld', true))).toEqual({
      primary: 'retry',
      secondary: 'fallback',
    });
    expect(failureActions(failed('gpuDriverTooOld', false))).toEqual({
      primary: 'retry',
      secondary: 'back',
    });
  });

  it('A2: another backend failure with an offer makes the fallback the main button', () => {
    for (const code of [
      'gpuError',
      'missingLibrary',
      'openclNoDevice',
      'outOfMemory',
      'timedOut',
      'crashed',
      'downloadFailed',
      'diskError',
    ] as FailureCode[]) {
      expect(failureActions(failed(code, true)), code).toEqual({
        primary: 'fallback',
        secondary: 'retry',
      });
    }
  });

  it('A2 without Retry for a declined licence', () => {
    expect(failureActions(failed('licenceNotAccepted', true))).toEqual({
      primary: 'fallback',
      secondary: null,
    });
    expect(failureActions(failed('licenceNotAccepted', false))).toEqual({
      primary: 'back',
      secondary: null,
    });
  });

  it('B: no offer gives Retry and Back', () => {
    for (const code of [
      'downloadFailed',
      'notEnoughSpace',
      'gpuError',
      'diskError',
    ] as FailureCode[]) {
      expect(failureActions(failed(code, false)), code).toEqual({
        primary: 'retry',
        secondary: 'back',
      });
    }
  });
});
