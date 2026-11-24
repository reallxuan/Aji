import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resetTrendStore, useTrendStore } from '../analysis/trendStore';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { useSettingsStore } from '../settings/settingsStore';
import type { JobOptions } from '../transport/generated/JobOptions';
import type { Request } from '../transport/generated/Request';
import type { TrendNode } from '../transport/generated/TrendNode';
import type { UiSettings } from '../transport/generated/UiSettings';
import { JobPanelContent } from './JobPanel';
import { DEFAULT_JOB_OPTIONS } from './estimate';

const settings = (jobOptions: JobOptions): UiSettings => ({
  language: 'zh-CN',
  theme: 'system',
  discLines: ['winrate', 'scoreLead'],
  visitLimit: null,
  defaultRules: { kind: 'chinese' },
  showCoordinates: true,
  perspective: 'black',
  showNextMove: true,
  analyseOnOpen: false,
  cacheCapMb: 1024,
  saveAnalysis: false,
  jobOptions,
});

const nodes = Array.from({ length: 41 }, (_, i): TrendNode => ({
  moveNumber: i,
  mover: i === 0 ? null : i % 2 ? 'black' : 'white',
  move: null,
  stats: null,
  loss: null,
}));

beforeEach(() => useTrendStore.getState().setNodes(nodes, 1));
afterEach(() => {
  resetGameStore();
  resetTrendStore();
  useSettingsStore.setState({ settings: null });
});

function mount(saved: JobOptions = DEFAULT_JOB_OPTIONS, language?: 'en') {
  useSettingsStore.setState({ settings: settings(saved) });
  let closed = 0;
  const harness = renderWithGame(<JobPanelContent onDone={() => closed++} />, {
    language,
    snapshot: makeSnapshot({ lineLength: 40, hasMoves: true }),
    answer: (request: Request) =>
      request.type === 'settingsSet'
        ? { type: 'settings', settings: request.settings }
        : request.type === 'jobStart'
          ? { type: 'ok' }
          : undefined,
  });
  return { ...harness, closed: () => closed };
}

const started = (requests: Request[]) =>
  requests.flatMap((r) => (r.type === 'jobStart' ? [r.options] : []));

it('job panel starts with the saved options', async () => {
  const saved: JobOptions = {
    range: { kind: 'whole' },
    side: 'white',
    visits: 800,
    boost: { on: false, threshold: 10, visits: 3000 },
  };
  const { requests, closed } = mount(saved);
  expect(screen.getByRole('radio', { name: '只白' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('textbox', { name: '每手计算量' })).toHaveValue('800');
  expect(screen.getByRole('checkbox', { name: '波动时加强' })).not.toBeChecked();
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: '双方' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
  });
  const options = { ...saved, side: 'both' };
  expect(started(requests)).toEqual([options]);
  // The choices are remembered for the next game.
  expect(requests).toContainEqual({
    type: 'settingsSet',
    settings: settings(options as JobOptions),
  });
  expect(closed()).toBe(1);
});

it('job panel one section shows the move fields', async () => {
  const { requests } = mount();
  expect(screen.queryByRole('textbox', { name: '起始手数' })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: '一段' }));
  });
  const from = screen.getByRole('textbox', { name: '起始手数' });
  const to = screen.getByRole('textbox', { name: '结束手数' });
  expect([from, to].map((f) => (f as HTMLInputElement).value)).toEqual(['1', '40']);
  fireEvent.change(from, { target: { value: '12' } });
  fireEvent.change(to, { target: { value: '30' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
  });
  expect(started(requests)[0].range).toEqual({ kind: 'moves', from: 12, to: 30 });
});

it('the estimate line counts the positions and says boosting is extra', () => {
  mount();
  const note = screen.getByTestId('job-estimate');
  expect(note).toHaveTextContent('共 41 个局面');
  expect(note).toHaveTextContent('加强另计');
  fireEvent.click(screen.getByRole('checkbox', { name: '波动时加强' }));
  expect(screen.getByTestId('job-estimate')).not.toHaveTextContent('加强另计');
  fireEvent.click(screen.getByRole('radio', { name: '只黑' }));
  expect(screen.getByTestId('job-estimate')).toHaveTextContent('只分析黑棋的 21 手');
});

it('the english estimate counts one position in the singular', () => {
  useTrendStore.getState().setNodes(nodes.slice(0, 1), 1);
  mount(DEFAULT_JOB_OPTIONS, 'en');
  const note = screen.getByTestId('job-estimate');
  expect(note).toHaveTextContent('Analyses 1 position, plus boosting.');
  act(() => useTrendStore.getState().setNodes(nodes.slice(0, 3), 1));
  expect(screen.getByTestId('job-estimate')).toHaveTextContent('Analyses 3 positions');
  fireEvent.click(screen.getByRole('radio', { name: 'White only' }));
  expect(screen.getByTestId('job-estimate')).toHaveTextContent("Analyses White's 1 move");
});

it('when every position has results, the estimate says only boosting runs', () => {
  const done = nodes.map((n) => ({ ...n, stats: { winrate: 0.5, scoreLead: 0, visits: 600 } }));
  useTrendStore.getState().setNodes(done, 1);
  mount();
  const note = screen.getByTestId('job-estimate');
  expect(note).toHaveTextContent('41 个局面都已有结果，只做加强。');
  expect(note).not.toHaveTextContent('其余');
  fireEvent.click(screen.getByRole('checkbox', { name: '波动时加强' }));
  expect(screen.getByTestId('job-estimate')).toHaveTextContent('41 个局面都已有结果。');
});

it('the start button is readable', () => {
  mount();
  // The shadcn primary button: its text and fill are different colours.
  expect(screen.getByRole('button', { name: '开始' })).toHaveAttribute('data-variant', 'default');
});

it('return starts the job', async () => {
  const { requests } = mount();
  const visits = screen.getByRole('textbox', { name: '每手计算量' });
  fireEvent.change(visits, { target: { value: '1200' } });
  await act(async () => {
    fireEvent.keyDown(visits, { key: 'Enter' });
  });
  expect(started(requests)).toEqual([{ ...DEFAULT_JOB_OPTIONS, visits: 1200 }]);
  expect(within(document.body).queryByText('开始')).not.toBeNull();
});
