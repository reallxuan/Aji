import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { EngineStoreProvider } from '../engine/engineStore';
import { createEngineStore } from '../engine/engineStore';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { PlatformProvider } from '../platform/PlatformProvider';
import { createFakeTransport } from '../transport/fake';
import type { EngineState } from '../transport/generated/EngineState';
import type { Request } from '../transport/generated/Request';
import { TransportProvider } from '../transport/TransportProvider';
import { engineAction } from '../engine/engineAction';
import { EngineIndicator } from './EngineIndicator';
import { initialWizard, useWizardStore } from '../setup/wizardStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';

function renderWith(engine: EngineState, requests: Request[] = []) {
  const store = createEngineStore();
  store.getState().applyEvent({ type: 'engineState', engine });
  const transport = createFakeTransport((request) => {
    requests.push(request);
    return { type: 'ok' };
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={createI18n('en')}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={store}>
          <PlatformProvider files={createFakeFiles()}>{children}</PlatformProvider>
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>
  );
  return render(<EngineIndicator />, { wrapper: wrap });
}

it('pauses analysis when clicked while analysing', async () => {
  const requests: Request[] = [];
  renderWith({ state: 'analysing', version: '1' }, requests);
  const button = screen.getByRole('button', { name: 'Pause analysis' });
  // The hover card names the state; a native tooltip would cover it.
  expect(button).not.toHaveAttribute('title');
  fireEvent.click(button);
  expect(requests.filter((r) => r.type !== 'appInfo')).toEqual([{ type: 'analysisPause' }]);
});

it('resumes analysis when clicked while paused', async () => {
  const requests: Request[] = [];
  renderWith({ state: 'paused', version: '1' }, requests);
  fireEvent.click(screen.getByRole('button', { name: 'Resume analysis' }));
  expect(requests.filter((r) => r.type !== 'appInfo')).toEqual([{ type: 'analysisResume' }]);
});

it('is disabled when crashed', () => {
  renderWith({ state: 'crashed', reason: 'exited', exit: null, stderrTail: [] });
  const button = screen.getByRole('button', { name: 'KataGo has stopped.' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('data-state', 'crashed');
});

it('is grey with no engine, and clicking it opens the wizard', () => {
  useWizardStore.setState(initialWizard);
  renderWith({ state: 'notConfigured' });
  const dot = screen.getByRole('button', { name: 'Set up the engine' });
  expect(dot).toHaveClass('bg-line');
  fireEvent.click(dot);
  expect(useWizardStore.getState()).toMatchObject({ open: true, rerun: false });
});

it('turns grey while the open game’s position cannot be analysed', () => {
  useGameStore.getState().apply(makeSnapshot({ illegal: 'occupied', positionKey: null }));
  try {
    renderWith({ state: 'analysing', version: '1' });
    expect(screen.getByRole('button', { name: 'Pause analysis' })).toHaveClass('bg-line');
  } finally {
    resetGameStore();
  }
});

it('is a hollow ring when the position stopped at its visit limit', () => {
  renderWith({ state: 'ready', version: '1', limitReached: true });
  const dot = screen.getByRole('button', { name: 'Search further' });
  expect(dot).toHaveAttribute('data-state', 'limitReached');
  expect(dot).toHaveClass('bg-transparent', 'ring-2', 'ring-engine-ok', 'ring-inset');
});

it('continues the search when clicked at the limit', () => {
  const requests: Request[] = [];
  renderWith({ state: 'ready', version: '1', limitReached: true }, requests);
  fireEvent.click(screen.getByRole('button', { name: 'Search further' }));
  expect(requests.filter((r) => r.type !== 'appInfo')).toEqual([{ type: 'analysisContinue' }]);
});

it.each<[EngineState | null, ReturnType<typeof engineAction>]>([
  [null, null],
  [{ state: 'notConfigured' }, 'setUp'],
  [{ state: 'starting' }, null],
  [{ state: 'ready', version: '1', limitReached: false }, null],
  [{ state: 'ready', version: '1', limitReached: true }, 'continue'],
  [{ state: 'analysing', version: '1' }, 'pause'],
  [{ state: 'paused', version: '1' }, 'resume'],
  [{ state: 'stopped' }, null],
  [{ state: 'crashed', reason: 'exited', exit: null, stderrTail: [] }, null],
])('the action for %j is %s', (state, action) => {
  expect(engineAction(state)).toBe(action);
});
