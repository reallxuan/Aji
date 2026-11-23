import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetEstimateStore, useEstimateStore } from '../analysis/estimateStore';
import { resetTrendStore, useTrendStore } from '../analysis/trendStore';
import { createEngineStore, EngineStoreProvider, type EngineStore } from '../engine/engineStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { createI18n } from '../i18n/createI18n';
import { resetScoringStore, useScoringStore } from '../scoring/scoringStore';
import { createFakeTransport } from '../transport/fake';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { Request } from '../transport/generated/Request';
import type { ScoreView } from '../transport/generated/ScoreView';
import type { TrendNode } from '../transport/generated/TrendNode';
import { TransportProvider } from '../transport/TransportProvider';
import { WinrateBar } from './WinrateBar';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
  resetEstimateStore();
  resetTrendStore();
  resetScoringStore();
});

const KEY = 'efefefefefefefef';
const side = (total: number) => ({ stones: 0, territory: 0, dead: 0, prisoners: 0, total });
const SCORE: ScoreView = {
  black: side(185),
  white: side(183.5),
  komi: 7.5,
  margin: 1.5,
  owners: [],
  openByOwnership: false,
  suggestedDead: [],
};

function analysis(ownership: number[] | null): AnalysisUpdate {
  return {
    position: KEY,
    boardSize: 19,
    rootVisits: 400,
    winrate: 0.58,
    scoreLead: 2.1,
    isFinal: false,
    candidates: [],
    previousVisits: 0,
    ownership,
    next: null,
  };
}

function mount(snapshot: Partial<GameSnapshot> = {}, score: ScoreView = SCORE) {
  const requests: Request[] = [];
  const transport = createFakeTransport((request) => {
    requests.push(request);
    if (request.type === 'gameScore') return { type: 'score', ...score };
    return { type: 'ok' };
  });
  const engine: EngineStore = createEngineStore();
  engine
    .getState()
    .applyEvent({ type: 'engineState', engine: { state: 'analysing', version: '1.18.2' } });
  useGameStore.getState().bindEngine(engine);
  useGameStore.getState().apply(makeSnapshot({ revision: 1, positionKey: KEY, ...snapshot }));
  render(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={engine}>
          <WinrateBar width={400} measure={(text) => text.length * 8} />
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>,
  );
  const analyse = (ownership: number[] | null) =>
    act(async () =>
      engine.getState().applyEvent({ type: 'analysisUpdate', analysis: analysis(ownership) }),
    );
  return { requests, analyse };
}

const OWNERSHIP = Array.from({ length: 361 }, () => 100);
const line = () => screen.queryByTestId('estimate-line');
const scores = (requests: Request[]) => requests.filter((r) => r.type === 'gameScore');

it('t_shows_and_hides_the_line_and_squares', async () => {
  const { analyse } = mount();
  await analyse(OWNERSHIP);
  expect(line()).toBeNull();
  act(() => useEstimateStore.getState().toggle());
  expect(line()).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '关闭形势判断' }));
  expect(useEstimateStore.getState().on).toBe(false);
  expect(line()).toBeNull();
});

it('the_line_reads_the_backends_score', async () => {
  const { requests, analyse } = mount();
  act(() => useEstimateStore.getState().toggle());
  // No ownership for this position yet: it says so, and asks for nothing.
  expect(line()).toHaveTextContent('形势判断等待这个局面的分析结果');
  expect(scores(requests)).toHaveLength(0);
  await analyse(OWNERSHIP);
  await act(async () => {});
  expect(scores(requests)).toEqual([{ type: 'gameScore', mode: { kind: 'estimate' } }]);
  // White's count leaves komi out: 185 − 176 − 7.5 = 1.5.
  expect(line()).toHaveTextContent('形势判断黑 185白 176贴目 7.5黑领先 1.5 目');
});

it('refetches on new ownership at most every half second', async () => {
  const { requests, analyse } = mount();
  act(() => useEstimateStore.getState().toggle());
  await analyse(OWNERSHIP);
  await analyse([...OWNERSHIP]);
  await analyse([...OWNERSHIP]);
  expect(scores(requests)).toHaveLength(1);
  await act(async () => vi.advanceTimersByTime(500));
  expect(scores(requests)).toHaveLength(2);
});

it('reads 白领先 when White leads', async () => {
  const { analyse } = mount({}, { ...SCORE, margin: -3.5 });
  act(() => useEstimateStore.getState().toggle());
  await analyse(OWNERSHIP);
  await act(async () => {});
  expect(line()).toHaveTextContent('白领先 3.5 目');
});

const PASS_NODES: TrendNode[] = [0, 1, 2].map((i) => ({
  moveNumber: i,
  mover: i === 0 ? null : i % 2 ? 'black' : 'white',
  move: i === 0 ? null : { type: 'pass' },
  stats: null,
  loss: null,
}));

it('finished_game_offers_scoring', async () => {
  useTrendStore.getState().setNodes(PASS_NODES, 1);
  const { analyse } = mount({ atEnd: true, lineIndex: 2 });
  act(() => useEstimateStore.getState().toggle());
  await analyse(OWNERSHIP);
  fireEvent.click(screen.getByRole('button', { name: '点目' }));
  expect(useScoringStore.getState().active).toBe(true);
});

it('a game with a result offers scoring at its last move, and not before', async () => {
  const info = makeSnapshot().info;
  const { analyse } = mount({ atEnd: false, info: { ...info, result: 'B+3.5' } });
  act(() => useEstimateStore.getState().toggle());
  await analyse(OWNERSHIP);
  expect(screen.queryByRole('button', { name: '点目' })).toBeNull();
  act(() =>
    useGameStore.getState().apply(
      makeSnapshot({
        revision: 2,
        positionKey: KEY,
        atEnd: true,
        info: { ...info, result: 'B+3.5' },
      }),
    ),
  );
  expect(screen.getByRole('button', { name: '点目' })).toBeInTheDocument();
});
