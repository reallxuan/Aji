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
