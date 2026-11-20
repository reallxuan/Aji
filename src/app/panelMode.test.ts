import { describe, expect, it } from 'vitest';
import type { EngineState } from '../transport/generated/EngineState';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import { panelMode } from './panelMode';

const notConfigured: EngineState = { state: 'notConfigured' };
const ready: EngineState = { state: 'ready', version: '1.18.2' };
const closed = { open: false, dismissed: false };
const job = (outcome: JobSnapshot['outcome']): JobSnapshot => ({
  id: 1,
  engine: 'e',
  backend: 'cuda',
  network: 'n',
  tasks: [],
  outcome,
  measures: false,
  benchmark: null,
});

describe('panelMode (M5 design 5.1)', () => {
  it('shows the wizard when no engine is set up and it was not dismissed this run', () => {
    expect(panelMode(notConfigured, closed, false, null)).toBe('wizard');
  });

  it('shows the analysis panel once the wizard was dismissed this run', () => {
    expect(panelMode(notConfigured, { open: false, dismissed: true }, false, null)).toBe(
      'analysis',
    );
  });

  it('shows the wizard while a job runs, whatever else is set', () => {
    expect(panelMode(ready, { open: false, dismissed: true }, true, job(null))).toBe('wizard');
  });

  it('shows the wizard when it was opened again over a running engine', () => {
    expect(panelMode(ready, { open: true, dismissed: false }, false, null)).toBe('wizard');
  });

  it('shows the analysis panel for any configured engine', () => {
    for (const engine of [
      ready,
      { state: 'starting' },
      { state: 'stopped' },
      { state: 'crashed', reason: 'exited', exit: null, stderrTail: [] },
    ] as EngineState[]) {
      expect(panelMode(engine, closed, false, null)).toBe('analysis');
    }
  });

  it('shows the analysis panel before the engine state is known', () => {
    expect(panelMode(null, closed, false, null)).toBe('analysis');
  });

  it('shows settings when they are open and no wizard is', () => {
    expect(panelMode(ready, closed, true, null)).toBe('settings');
    expect(panelMode(ready, closed, true, job({ outcome: 'installed' }))).toBe('settings');
  });

  it('a finished job no longer holds the wizard open', () => {
    expect(panelMode(ready, closed, false, job({ outcome: 'installed' }))).toBe('analysis');
  });
});
