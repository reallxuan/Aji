import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { EngineStoreProvider } from '../engine/engineStore';
import { createEngineStore } from '../engine/engineStore';
import { createI18n } from '../i18n/createI18n';
import { createFakeTransport } from '../transport/fake';
import type { EngineState } from '../transport/generated/EngineState';
import type { Request } from '../transport/generated/Request';
import { TransportProvider } from '../transport/TransportProvider';
import { EngineIndicator } from './EngineIndicator';

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
        <EngineStoreProvider store={store}>{children}</EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>
  );
  return render(<EngineIndicator />, { wrapper: wrap });
}

it('pauses analysis when clicked while analysing', async () => {
  const requests: Request[] = [];
  renderWith({ state: 'analysing', version: '1' }, requests);
  const button = screen.getByRole('button', { name: 'Pause analysis' });
  expect(button).toHaveAttribute('title', 'Analysing');
  fireEvent.click(button);
  expect(requests).toEqual([{ type: 'analysisPause' }]);
});

it('resumes analysis when clicked while paused', async () => {
  const requests: Request[] = [];
  renderWith({ state: 'paused', version: '1' }, requests);
  fireEvent.click(screen.getByRole('button', { name: 'Resume analysis' }));
  expect(requests).toEqual([{ type: 'analysisResume' }]);
});

it('is disabled when crashed', () => {
  renderWith({ state: 'crashed', reason: 'exited', exit: null, stderrTail: [] });
  const button = screen.getByRole('button', { name: 'KataGo has stopped.' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('data-state', 'crashed');
});
