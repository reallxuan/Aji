import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { createI18n } from '../i18n/createI18n';
import type { Candidate } from '../transport/generated/Candidate';
import { CandidateList } from './CandidateList';

function candidate(order: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    move: { type: 'play', x: order % 19, y: 0 },
    order,
    visits: 10,
    winrate: 0.5,
    scoreLead: 0,
    prior: 0.1,
    pv: [],
    ...overrides,
  };
}

function renderWith(candidates: Candidate[]) {
  const store = createEngineStore();
  store.getState().setPosition('ab');
  store.getState().applyEvent({
    type: 'analysisUpdate',
    analysis: {
      position: 'ab',
      boardSize: 19,
      rootVisits: 100,
      winrate: 0.5,
      scoreLead: 0,
      isFinal: false,
      candidates,
      previousVisits: 0,
    },
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={createI18n('en')}>
      <EngineStoreProvider store={store}>{children}</EngineStoreProvider>
    </I18nextProvider>
  );
  return render(<CandidateList />, { wrapper: wrap });
}

it('formats a candidate row', () => {
  renderWith([
    candidate(0, {
      move: { type: 'play', x: 15, y: 3 },
      winrate: 0.3721,
      scoreLead: -0.95,
      visits: 1234,
    }),
  ]);
  expect(screen.getByText('Move')).toBeInTheDocument();
  expect(screen.getByText('Black win rate')).toBeInTheDocument();
  expect(screen.getByText('Black lead')).toBeInTheDocument();
  expect(screen.getByText('Visits')).toBeInTheDocument();
  expect(screen.getByText('Q16')).toBeInTheDocument();
  expect(screen.getByText('37.2%')).toBeInTheDocument();
  expect(screen.getByText('-1.0')).toBeInTheDocument();
  expect(screen.getByText('1,234')).toBeInTheDocument();
});

it('stops at 10 rows', () => {
  renderWith(Array.from({ length: 20 }, (_, i) => candidate(i)));
  expect(screen.getAllByRole('row')).toHaveLength(11);
});
