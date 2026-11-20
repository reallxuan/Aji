import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { createI18n } from '../i18n/createI18n';
import type { Language } from '../i18n/language';
import { createFakeTransport } from '../transport/fake';
import type { EngineState } from '../transport/generated/EngineState';
import type { Request } from '../transport/generated/Request';
import { TransportProvider } from '../transport/TransportProvider';
import { EngineStatus } from './EngineStatus';
import { beforeEach, describe } from 'vitest';
import { useSettingsStore } from '../settings/settingsStore';
import { initialWizard, useWizardStore } from '../setup/wizardStore';

function renderWith(language: Language, engine: EngineState, requests: Request[] = []) {
  const store = createEngineStore();
  store.getState().applyEvent({ type: 'engineState', engine });
  const transport = createFakeTransport((request) => {
    requests.push(request);
    return { type: 'ok' };
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={createI18n(language)}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={store}>{children}</EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>
  );
  return render(<EngineStatus />, { wrapper: wrap });
}

it('shows the crash reason, exit line and stderr tail, and restarts', async () => {
  const requests: Request[] = [];
  renderWith(
    'en',
    {
      state: 'crashed',
      reason: 'exited',
      exit: { code: null, signal: 6 },
      stderrTail: ['first line', 'libc++abi: terminating'],
    },
    requests,
  );
  expect(screen.getByText('KataGo quit unexpectedly.')).toBeInTheDocument();
  expect(screen.getByText('Ended by signal 6')).toBeInTheDocument();
  expect(screen.getByText(/first line/)).toBeInTheDocument();
  expect(screen.getByText(/libc\+\+abi: terminating/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restart engine' }));
  expect(requests).toEqual([{ type: 'engineRestart' }]);
});

it('shows the not-configured state in Chinese', () => {
  renderWith('zh-CN', { state: 'notConfigured' });
  expect(screen.getByText('尚未设置引擎。')).toBeInTheDocument();
});

it('renders nothing while analysing', () => {
  const { container } = renderWith('en', { state: 'analysing', version: '1' });
  expect(container).toBeEmptyDOMElement();
});

describe('M5 additions', () => {
  beforeEach(() => {
    useWizardStore.setState(initialWizard);
    useSettingsStore.setState({ settings: null });
  });

  it('offers to set the engine up again after a crash', () => {
    renderWith('zh-CN', { state: 'crashed', reason: 'exited', exit: null, stderrTail: [] });
    fireEvent.click(screen.getByRole('button', { name: '重新设置引擎' }));
    expect(useWizardStore.getState()).toMatchObject({ open: true, rerun: true });
  });

  it('says the visit limit was reached when a ready engine stopped at it', () => {
    useSettingsStore.setState({
      settings: {
        language: 'zh-CN',
        theme: 'system',
        discLines: ['winrate', 'scoreLead'],
        visitLimit: 500,
        defaultRules: { kind: 'chinese' },
      },
    });
    const store = createEngineStore();
    store.setState({
      engine: { state: 'ready', version: '1.18.2' },
      sawEvent: true,
      position: 'aaaaaaaaaaaaaaaa',
      analysis: {
        position: 'aaaaaaaaaaaaaaaa',
        boardSize: 19,
        rootVisits: 512,
        winrate: 0.5,
        scoreLead: 0,
        isFinal: true,
        candidates: [],
      },
    });
    render(
      <I18nextProvider i18n={createI18n('zh-CN')}>
        <TransportProvider transport={createFakeTransport(() => ({ type: 'ok' }))}>
          <EngineStoreProvider store={store}>
            <EngineStatus />
          </EngineStoreProvider>
        </TransportProvider>
      </I18nextProvider>,
    );
    expect(screen.getByText('已达到每步上限')).toBeInTheDocument();
  });
});
