import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { resetDeviceStore, useDeviceStore } from '../device/deviceStore';
import { DEFAULT_DEVICE_SETTINGS } from '../device/deviceSettings';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it } from 'vitest';
import { subBoardHarness } from '../analysis/subBoardTesting';
import { MainBoard } from '../layout/MainBoard';
import { WinrateBar } from './WinrateBar';
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
import { PanelSizeContext } from '../layout/usePanelWidth';
import { CandidateTable } from './CandidateTable';
import { storedSettings } from '../setup/testing';

afterEach(() => {
  cleanup();
  resetGameStore();
  resetViewStore();
  resetDeviceStore();
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
    ownership: null,
    next: null,
    ...overrides,
  };
}

function mount(
  options: {
    update?: AnalysisUpdate | null;
    nextMove?: Move | null;
    toPlay?: Color;
    engine?: EngineState;
    /** The panel's width; 0 is outside any panel. */
    width?: number;
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
        <PanelSizeContext.Provider value={{ width: options.width ?? 0, height: 400 }}>
          <CandidateTable />
        </PanelSizeContext.Provider>
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

/** Turns 与最佳相比 back on: it is off by default since P2 M2 (design 5.5). */
const withVsBest = () =>
  useDeviceStore.getState().update({
    candidateColumns: { ...DEFAULT_DEVICE_SETTINGS.candidateColumns, vsBest: true },
  });
const headerNames = () =>
  within(screen.getAllByRole('row')[0])
    .getAllByRole('columnheader')
    .map((c) => c.textContent);

it('has the columns of design 4.3 in order, with the share in the visits cell', () => {
  mount();
  expect(headerNames()).toEqual(['', '落点', '胜率', '目差', '计算量']);
  const first = rows()[0];
  expect(
    within(first)
      .getAllByRole('cell')
      .map((c) => c.textContent),
  ).toEqual(['1', 'Q16', '54.2%', '+0.8', '1.2k39%']);
});

it('with 与最佳相比 on, it is the last column', () => {
  withVsBest();
  mount();
  expect(headerNames()).toEqual(['', '落点', '胜率', '目差', '计算量', '与最佳相比']);
  expect(within(rows()[0]).getAllByRole('cell').at(-1)).toHaveTextContent('最佳');
  expect(within(rows()[1]).getByText('−1.8%')).toBeInTheDocument();
});

it('labels the played move, in bold', () => {
  withVsBest();
  mount({ nextMove: play(13) });
  const played = within(rows()[2]).getByText('实战 −1.1%');
  expect(played).toHaveClass('font-semibold');
  expect(rows()[2].querySelector('[data-played]')).not.toBeNull();
});

it('reads 实战 最佳 when the played move is the best', () => {
  withVsBest();
  mount({ nextMove: play(15) });
  expect(within(rows()[0]).getByText('实战 最佳')).toBeInTheDocument();
});

it('keeps the board, rows and win rates at full opacity while visits catch up', async () => {
  const { wrapper, engine } = subBoardHarness();
  const { container } = render(
    <>
      <MainBoard rect={{ x: 0, y: 0, width: 400, height: 400 }} />
      <CandidateTable />
      <WinrateBar width={492} />
    </>,
    { wrapper },
  );
  for (const rootVisits of [640, 1000]) {
    await act(async () => {
      engine.getState().applyEvent({
        type: 'analysisUpdate',
        analysis: analysis({ rootVisits, previousVisits: 1000 }),
      });
    });
    if (rootVisits === 640) expect(screen.getByText('总计算量 640 / 1,000')).toBeVisible();
    else expect(screen.queryByText('总计算量 640 / 1,000')).toBeNull();

    const discs = container.querySelector('canvas[data-layer="candidates"]')!;
    const bar = within(screen.getByTestId('winrate-bar'));
    expect(rows()).toHaveLength(CANDIDATES.length);
    for (const element of [discs, ...rows(), bar.getByText('54.2%'), bar.getByText('45.8%')])
      expect(getComputedStyle(element).opacity || '1').toBe('1');
  }
});

it('a paused search shows its own total, not the catching-up header', () => {
  mount({
    update: analysis({ rootVisits: 640, previousVisits: 1000 }),
    engine: { state: 'paused', version: '1.18.2' },
  });
  expect(screen.getByText('总计算量 640')).toBeInTheDocument();
});

it('a restarting engine does not keep the catching-up header', () => {
  mount({
    update: analysis({ rootVisits: 640, previousVisits: 1000 }),
    engine: { state: 'starting' },
  });
  expect(screen.queryByText('总计算量 640 / 1,000')).toBeNull();
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

it('shows the side to move’s numbers, whatever the graph’s perspective (P2 M1 design 5.10)', () => {
  withVsBest();
  useDeviceStore.getState().update({ perspective: 'white' });
  mount();
  // Black to move; Black's best is 54.2% and +0.8 for Black.
  expect(within(rows()[0]).getByText('54.2%')).toBeInTheDocument();
  expect(within(rows()[0]).getByText('+0.8')).toBeInTheDocument();
  expect(within(rows()[1]).getByText('52.4%')).toBeInTheDocument();
  expect(within(rows()[1]).getByText('−1.8%')).toBeInTheDocument();
});

it('shows White’s numbers when White is to move, and the difference of what it shows', () => {
  withVsBest();
  useDeviceStore.getState().update({ perspective: 'black' });
  mount({ toPlay: 'white' });
  // Black's 54.2% and +0.8 are White's 45.8% and −0.8.
  expect(within(rows()[0]).getByText('45.8%')).toBeInTheDocument();
  expect(within(rows()[0]).getByText('−0.8')).toBeInTheDocument();
  // Black's 52.4% is White's 47.6%: 1.8 points better for White than after White's first.
  expect(within(rows()[1]).getByText('47.6%')).toBeInTheDocument();
  expect(within(rows()[1]).getByText('+1.8%')).toBeInTheDocument();
});

it('a narrow panel keeps the point, win rate and lead (P2 M1 layouts mockup)', () => {
  mount({ width: 286 });
  const names = () =>
    within(screen.getAllByRole('row')[0])
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
  expect(names()).toEqual(['', '落点', '胜率', '目差']);
  expect(within(rows()[0]).getAllByRole('cell')).toHaveLength(4);
});

it('a panel of 360 px or more shows every chosen column', () => {
  mount({ width: 360 });
  expect(within(screen.getAllByRole('row')[0]).getAllByRole('columnheader')).toHaveLength(5);
});

it('narrow_panel_still_falls_back_to_four_columns', () => {
  withVsBest();
  mount({ width: 286 });
  expect(headerNames()).toEqual(['', '落点', '胜率', '目差']);
  expect(within(rows()[0]).getAllByRole('cell')).toHaveLength(4);
});

const header = (name: string) =>
  within(screen.getAllByRole('row')[0]).getByRole('button', { name });
const chips = () => rows().map((r) => within(r).getAllByRole('cell')[0].textContent);

it('header_click_cycles_descending_ascending_rank', () => {
  mount();
  // Leads: 1 +0.8, 2 +0.5, 3 +0.6, 4 −0.2.
  fireEvent.click(header('目差'));
  expect(chips()).toEqual(['1', '3', '2', '4']);
  expect(header('目差').closest('[role=columnheader]')).toHaveAttribute('aria-sort', 'descending');
  expect(useDeviceStore.getState().settings.candidateSort).toEqual({
    key: 'scoreLead',
    descending: true,
  });
  fireEvent.click(header('目差'));
  expect(chips()).toEqual(['4', '2', '3', '1']);
  expect(header('目差').closest('[role=columnheader]')).toHaveAttribute('aria-sort', 'ascending');
  fireEvent.click(header('目差'));
  expect(chips()).toEqual(['1', '2', '3', '4']);
  expect(header('目差').closest('[role=columnheader]')).not.toHaveAttribute('aria-sort');
});

it('chips_keep_katago_numbers_when_sorted', () => {
  useDeviceStore.getState().update({ candidateSort: { key: 'visits', descending: false } });
  mount();
  // The fewest visits first, still chip 4: it matches its disc on the board.
  expect(chips()).toEqual(['4', '3', '2', '1']);
  expect(within(rows()[0]).getAllByRole('cell')[1]).toHaveTextContent('N16');
});

it('vs_best_is_off_by_default_and_played_gets_a_tag', () => {
  mount({ nextMove: play(13) });
  expect(headerNames()).not.toContain('与最佳相比');
  const tag = within(rows()[2]).getByText('实战');
  expect(within(rows()[2]).getAllByRole('cell')[1]).toContainElement(tag);
  expect(within(rows()[0]).queryByText('实战')).toBeNull();
});

it('share_shows_in_the_visits_cell', () => {
  mount();
  const visits = () => within(rows()[0]).getAllByRole('cell')[4];
  expect(visits()).toHaveTextContent('1.2k39%');
  expect(visits().querySelector('[data-share-bar]')).toHaveStyle({ width: '39%' });
  cleanup();
  resetGameStore();
  useDeviceStore.getState().update({
    candidateColumns: { ...DEFAULT_DEVICE_SETTINGS.candidateColumns, share: false },
  });
  mount();
  expect(visits()).toHaveTextContent(/^1\.2k$/);
  expect(visits().querySelector('[data-share-bar]')).toBeNull();
});

it('column_menu_toggles_columns_and_count', async () => {
  mount();
  const open = () => fireEvent.contextMenu(screen.getAllByRole('row')[0]);
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '胜率' }));
  });
  // The menu stays open for another column; Escape closes it.
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  });
  expect(headerNames()).toEqual(['', '落点', '目差', '计算量']);
  expect(useDeviceStore.getState().settings.candidateColumns.winrate).toBe(false);
  open();
  expect(screen.getByRole('menuitemcheckbox', { name: '胜率' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  expect(screen.getByRole('menuitemcheckbox', { name: '占比' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /候选点数量/ }), { key: 'ArrowRight' });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '全部' }));
  });
  expect(useDeviceStore.getState().settings.candidateCount).toBe('all');
  useDeviceStore.getState().update({ candidateSort: { key: 'visits', descending: true } });
  open();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: '按 KataGo 排序' }));
  });
  expect(useDeviceStore.getState().settings.candidateSort).toEqual({
    key: 'rank',
    descending: true,
  });
});

it('wheel_over_a_row_steps_the_line', () => {
  mount();
  const row = rows()[0];
  fireEvent.mouseEnter(row);
  act(() =>
    useViewStore.getState().setVariation({
      moves: [3, 4, 5, 6].map((x) => ({ type: 'play' as const, x, y: x })),
      colors: ['black', 'white', 'black', 'white'],
      captured: [[], [], [], []],
      illegalAt: null,
    }),
  );
  expect(useViewStore.getState().step).toBe(4);
  const table = screen.getByRole('table');
  const up = createEvent.wheel(table, { deltaY: -100, deltaMode: 0 });
  fireEvent(table, up);
  // The line steps back instead of the table scrolling (M7 minor 7).
  expect(up.defaultPrevented).toBe(true);
  expect(useViewStore.getState().step).toBe(3);
  fireEvent.mouseLeave(row);
  const away = createEvent.wheel(table, { deltaY: -100, deltaMode: 0 });
  fireEvent(table, away);
  expect(away.defaultPrevented).toBe(false);
});

const NEXT = {
  stats: { winrate: 0.47, scoreLead: -0.6, visits: 320 },
  loss: { winrate: 7.2, score: 2.4 },
};

it('the_table_shows_the_played_row', () => {
  // The record's next move, R16, is not among KataGo's four.
  mount({ nextMove: play(16), update: analysis({ next: NEXT }) });
  expect(chips()).toEqual(['1', '2', '3', '4', '5']);
  const played = rows()[4];
  expect(within(played).getAllByRole('cell')[1]).toHaveTextContent('R16实战');
  expect(within(played).getAllByRole('cell')[2]).toHaveTextContent('47.0%');
  expect(within(played).getAllByRole('cell')[3]).toHaveTextContent('−0.6');
  expect(played.querySelector('[data-played]')).not.toBeNull();
});

it('the setting hides the played marks and the next move’s row', () => {
  useSettingsStore.setState({ settings: { ...storedSettings, showNextMove: false } });
  mount({ nextMove: play(13), update: analysis({ next: NEXT }) });
  expect(chips()).toEqual(['1', '2', '3', '4']);
  expect(screen.queryByText('实战')).toBeNull();
  expect(document.querySelector('[data-played]')).toBeNull();
});
