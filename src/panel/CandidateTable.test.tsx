import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useDeviceStore } from '../device/deviceStore';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it } from 'vitest';
import { resetViewStore, useViewStore } from '../analysis/viewStore';
import { createEngineStore, EngineStoreProvider, type EngineStore } from '../engine/engineStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { useSettingsStore } from '../settings/settingsStore';
import { makeSnapshot } from '../game/testing';
import { createI18n } from '../i18n/createI18n';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { Candidate } from '../transport/generated/Candidate';
import type { Color } from '../transport/generated/Color';
import type { EngineState } from '../transport/generated/EngineState';
import type { Move } from '../transport/generated/Move';
import { CandidateTable } from './CandidateTable';

afterEach(() => {
  resetGameStore();
  resetViewStore();
  useSettingsStore.setState({ settings: null });
});

const KEY = 'abababababababab';
const ANALYSING: EngineState = { state: 'analysing', version: '1.18.2' };
const play = (x: number, y = 3): Move => ({ type: 'play', x, y });

function candidate(order: number, winrate: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    move: play(15 - order),
    order,
    visits: 1200 - order * 200,
    winrate,
    scoreLead: (winrate - 0.5) * 20,
    prior: 0.1,
    pv: [play(15 - order)],
    ...overrides,
  };
}

const CANDIDATES = [
  candidate(0, 0.542),
  candidate(1, 0.524),
  candidate(2, 0.531),
  candidate(3, 0.49),
];

function analysis(overrides: Partial<AnalysisUpdate> = {}): AnalysisUpdate {
  return {
    position: KEY,
    boardSize: 19,
    rootVisits: 3104,
    winrate: 0.542,
    scoreLead: 0.8,
    isFinal: false,
    candidates: CANDIDATES,
    previousVisits: 0,
    ...overrides,
  };
}

function mount(
  options: {
    update?: AnalysisUpdate | null;
    nextMove?: Move | null;
    toPlay?: Color;
    engine?: EngineState;
  } = {},
) {
  const store: EngineStore = createEngineStore();
  store.getState().applyEvent({ type: 'engineState', engine: options.engine ?? ANALYSING });
  useGameStore.getState().bindEngine(store);
  useGameStore.getState().apply(
    makeSnapshot({
      revision: 1,
      positionKey: KEY,
      nextColor: options.toPlay ?? 'black',
      nextMove: options.nextMove ?? null,
    }),
  );
  const update = options.update === undefined ? analysis() : options.update;
  if (update) store.getState().applyEvent({ type: 'analysisUpdate', analysis: update });
  render(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <EngineStoreProvider store={store}>
        <CandidateTable />
      </EngineStoreProvider>
    </I18nextProvider>,
  );
  return store;
}

const rows = () => screen.queryAllByRole('row').filter((r) => r.dataset.rank);

it('shows the total visits, or how far a new search has come', () => {
  const store = mount();
  expect(screen.getByText('候选点')).toBeInTheDocument();
  expect(screen.getByText('总计算量 3.1k')).toBeInTheDocument();
  act(() =>
    store.getState().applyEvent({
      type: 'analysisUpdate',
      analysis: analysis({ rootVisits: 640, previousVisits: 1000 }),
    }),
  );
  expect(screen.getByText('总计算量 640 / 1,000')).toBeInTheDocument();
});

it('has the columns of design 4.3 in order', () => {
  mount();
  const header = screen.getAllByRole('row')[0];
  expect(
    within(header)
      .getAllByRole('columnheader')
      .map((c) => c.textContent),
  ).toEqual(['', '落点', '胜率', '目差', '计算量', '与最佳相比']);
  const first = rows()[0];
  expect(
    within(first)
      .getAllByRole('cell')
      .map((c) => c.textContent),
  ).toEqual(['1', 'Q16', '54.2%', '+0.8', '1.2k', '最佳']);
  expect(within(rows()[1]).getByText('−1.8%')).toBeInTheDocument();
});

it('labels the played move, in bold', () => {
  mount({ nextMove: play(13) });
  const played = within(rows()[2]).getByText('实战 −1.1%');
  expect(played).toHaveClass('font-semibold');
  expect(rows()[2].querySelector('[data-played]')).not.toBeNull();
});

it('reads 实战 · 最佳 when the played move is the best', () => {
  mount({ nextMove: play(15) });
  expect(within(rows()[0]).getByText('实战 · 最佳')).toBeInTheDocument();
});

it('fades the rows while catching up', () => {
  mount({ update: analysis({ rootVisits: 640, previousVisits: 1000 }) });
  for (const row of rows()) {
    expect(row).toHaveAttribute('data-catching-up');
    expect(row).toHaveStyle({ opacity: '0.6' });
  }
});

it('a paused search shows its own total, not the catching-up header', () => {
  mount({
    update: analysis({ rootVisits: 640, previousVisits: 1000 }),
    engine: { state: 'paused', version: '1.18.2' },
  });
  expect(screen.getByText('总计算量 640')).toBeInTheDocument();
  expect(document.querySelector('[data-catching-up]')).toBeNull();
  for (const row of rows()) expect(row).toHaveStyle({ opacity: '1' });
});

it('a restarting engine does not keep the catching-up header', () => {
  mount({
    update: analysis({ rootVisits: 640, previousVisits: 1000 }),
    engine: { state: 'starting' },
  });
  expect(screen.queryByText('总计算量 640 / 1,000')).toBeNull();
  expect(document.querySelector('[data-catching-up]')).toBeNull();
});

it('shows 已隐藏（F） and no rows while hidden', () => {
  mount();
  act(() => useViewStore.getState().toggleHidden());
  expect(screen.getByText('已隐藏（F）')).toBeInTheDocument();
  expect(rows()).toHaveLength(0);
  act(() => useViewStore.getState().toggleHidden());
  act(() => useViewStore.getState().setHeld(true));
  expect(rows()).toHaveLength(0);
});

it('hovering a row sets the hover, and a board hover highlights its row', () => {
  mount();
  fireEvent.mouseEnter(rows()[1]);
  expect(useViewStore.getState().hover).toEqual({ move: play(14), source: 'table' });
  expect(rows()[1]).toHaveAttribute('data-highlighted');
  fireEvent.mouseLeave(rows()[1]);
  expect(useViewStore.getState().hover).toBeNull();
  act(() => useViewStore.getState().setHover({ move: play(13), source: 'board' }));
  expect(rows()[2]).toHaveAttribute('data-highlighted');
  expect(rows()[1]).not.toHaveAttribute('data-highlighted');
});

it('the highlight follows the hovered move when the ranks reorder', () => {
  const store = mount();
  fireEvent.mouseEnter(rows()[1]);
  act(() =>
    store.getState().applyEvent({
      type: 'analysisUpdate',
      analysis: analysis({
        rootVisits: 3200,
        candidates: [
          candidate(0, 0.54, { move: play(14), pv: [play(14)] }),
          candidate(1, 0.53, { move: play(15), pv: [play(15)] }),
        ],
      }),
    }),
  );
  expect(useViewStore.getState().hover).toEqual({ move: play(14), source: 'table' });
  expect(rows()[0]).toHaveAttribute('data-highlighted');
  expect(rows()[1]).not.toHaveAttribute('data-highlighted');
});

it('says KataGo cannot analyse a rejected position, with its message as the title', () => {
  const store = mount({ update: null });
  act(() =>
    store.getState().applyEvent({
      type: 'analysisRejected',
      rejection: { position: KEY, message: 'Illegal move: superko' },
    }),
  );
  const line = screen.getByText('KataGo 无法分析这个局面');
  expect(line).toHaveAttribute('title', 'Illegal move: superko');
  expect(rows()).toHaveLength(0);
});

it('a new revision clears the hover', () => {
  mount();
  act(() => useViewStore.getState().setHover({ move: play(15), source: 'table' }));
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, positionKey: KEY })));
  expect(useViewStore.getState().hover).toBeNull();
});

it('shows how far the wheel has stepped a hovered line beside its point', () => {
  mount();
  act(() => {
    const view = useViewStore.getState();
    view.setHover({ move: play(15), source: 'board' });
    view.setVariation({
      moves: [play(15), play(14), play(13)],
      colors: ['black', 'white', 'black'],
      captured: [[], [], []],
      illegalAt: null,
    });
  });
  expect(within(rows()[0]).queryByText('3 / 3')).toBeNull();
  act(() => useViewStore.getState().setStep(2));
  expect(within(rows()[0]).getByText('2 / 3')).toBeInTheDocument();
});

it('shows White’s numbers in White’s perspective, and the difference of what it shows', () => {
  useDeviceStore.getState().update({ perspective: 'white' });
  mount();
  // Black to move; Black's best is 54.2% and +0.8 for Black.
  expect(within(rows()[0]).getByText('45.8%')).toBeInTheDocument();
  expect(within(rows()[0]).getByText('−0.8')).toBeInTheDocument();
  // Black's 52.4% is White's 47.6%: 1.8 points better for White than after Black's best.
  expect(within(rows()[1]).getByText('47.6%')).toBeInTheDocument();
  expect(within(rows()[1]).getByText('+1.8%')).toBeInTheDocument();
});

it('shows Black’s numbers in Black’s perspective when White is to move', () => {
  useDeviceStore.getState().update({ perspective: 'black' });
  mount({ toPlay: 'white' });
  // Black's numbers, not White's 45.8% and 47.6%.
  expect(within(rows()[0]).getByText('54.2%')).toBeInTheDocument();
  expect(within(rows()[0]).getByText('最佳')).toBeInTheDocument();
  expect(within(rows()[1]).getByText('52.4%')).toBeInTheDocument();
  expect(within(rows()[1]).getByText('−1.8%')).toBeInTheDocument();
});
