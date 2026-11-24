import { act, fireEvent, screen, within } from '@testing-library/react';
import { useDeviceStore } from '../device/deviceStore';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetTrendStore, useTrendStore } from '../analysis/trendStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { useSettingsStore } from '../settings/settingsStore';
import { storedSettings } from '../setup/testing';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import type { TrendNode } from '../transport/generated/TrendNode';
import { TrendGraph } from './TrendGraph';
import { resetJobStore, useJobStore } from '../job/jobStore';
import type { JobProgress } from '../transport/generated/JobProgress';

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame'] }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
  resetTrendStore();
  resetJobStore();
  useSettingsStore.setState({ settings: null });
});

const WIDTH = 540;
const PADL = 52;
const PADR = 44;

/** 101 nodes; plotted: 0–40, 42 alone, 60–100. Move 72 is White's at R14. */
function line(): TrendNode[] {
  return Array.from({ length: 101 }, (_, i) => {
    const plotted = i <= 40 || i === 42 || i >= 60;
    return {
      node: i + 200,
      key: i.toString(16).padStart(16, '0'),
      moveNumber: i,
      tryout: false,
      toPlay: i % 2 ? 'white' : 'black',
      mover: i === 0 ? null : i % 2 ? 'black' : 'white',
      move:
        i === 0
          ? null
          : i === 72
            ? { type: 'play', x: 16, y: 5 }
            : { type: 'play', x: i % 19, y: 9 },
      stats: plotted
        ? { winrate: i === 72 ? 0.495 : 0.5, scoreLead: i === 72 ? -0.1 : 0, visits: 200 }
        : null,
      loss: null,
    };
  });
}

function mount() {
  useTrendStore.getState().setNodes(line(), 0);
  const result = renderWithGame(<TrendGraph height={150} width={WIDTH} />, {
    snapshot: makeSnapshot({ revision: 1, lineIndex: 30, moveNumber: 30, lineLength: 100 }),
  });
  return result;
}

const xOf = (i: number) => PADL + (i / 100) * (WIDTH - PADL - PADR);
const svg = () => document.querySelector('svg')!;

it('draws one path per run for each line, and a dot for a lone node', () => {
  mount();
  expect(svg().querySelectorAll('path[data-line="winrate"]')).toHaveLength(2);
  expect(svg().querySelectorAll('path[data-line="scoreLead"]')).toHaveLength(2);
  expect(svg().querySelectorAll('circle[data-line="winrate"]')).toHaveLength(1);
  expect(svg().querySelectorAll('circle[data-line="scoreLead"]')).toHaveLength(1);
});

it('draws the dashed current line at the line index', () => {
  mount();
  const current = svg().querySelector('[data-current]')!;
  expect(Number(current.getAttribute('x1'))).toBeCloseTo(xOf(30));
  expect(current.getAttribute('stroke-dasharray')).toBe('3 3');
  act(() =>
    useGameStore.getState().apply(makeSnapshot({ revision: 2, lineIndex: 70, moveNumber: 70 })),
  );
  expect(Number(svg().querySelector('[data-current]')!.getAttribute('x1'))).toBeCloseTo(xOf(70));
});

it('shows a move’s numbers on hover, or says it has none', () => {
  mount();
  fireEvent.mouseMove(svg(), { clientX: xOf(72), clientY: 40 });
  expect(screen.getByText('第 72 手 白 R14')).toBeInTheDocument();
  expect(screen.getByText(/^胜率 49\.5%/)).toBeInTheDocument();
  expect(screen.getByText('目差 −0.1')).toBeInTheDocument();
  fireEvent.mouseMove(svg(), { clientX: xOf(50), clientY: 40 });
  expect(screen.getByText('尚未分析')).toBeInTheDocument();
  fireEvent.mouseLeave(svg());
  expect(screen.queryByText('尚未分析')).toBeNull();
});

const navigations = (requests: { type: string }[]) =>
  (requests.filter((r) => r.type === 'gameNavigate') as unknown as Array<{ to: unknown }>).map(
    (r) => r.to,
  );

it('goes to a move on click', async () => {
  const { requests } = mount();
  fireEvent.mouseDown(svg(), { clientX: xOf(72), clientY: 40, buttons: 1 });
  fireEvent.mouseUp(svg(), { clientX: xOf(72), clientY: 40 });
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  expect(navigations(requests)).toEqual([{ node: 272 }]);
});

it('scrubs while dragging, at most one navigation a frame', async () => {
  const { requests } = mount();
  fireEvent.mouseDown(svg(), { clientX: xOf(10), clientY: 40, buttons: 1 });
  for (const i of [11, 12, 13, 14])
    fireEvent.mouseMove(svg(), { clientX: xOf(i), clientY: 40, buttons: 1 });
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  expect(navigations(requests)).toEqual([{ node: 214 }]);
  fireEvent.mouseUp(svg());
  fireEvent.mouseMove(svg(), { clientX: xOf(20), clientY: 40, buttons: 0 });
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  expect(navigations(requests)).toEqual([{ node: 214 }]);
});

it('has a legend of 胜率 and 目差, without 失误, and no verdict', () => {
  mount();
  const legend = screen.getByTestId('trend-legend');
  expect(legend.textContent).toMatch(/^胜率目差/);
  expect(legend).not.toHaveTextContent('失误');
  expect(legend).not.toHaveTextContent('黑胜率');
});

it('draws no mistake bars, however large a loss', () => {
  const nodes = line();
  // Black's move 41 drops Black's win rate by 30 points.
  nodes[40] = { ...nodes[40], stats: { winrate: 0.8, scoreLead: 8, visits: 200 } };
  nodes[41] = { ...nodes[41], stats: { winrate: 0.5, scoreLead: 0, visits: 200 } };
  useTrendStore.getState().setNodes(nodes);
  renderWithGame(<TrendGraph height={150} width={WIDTH} />, {
    snapshot: makeSnapshot({ revision: 1, lineIndex: 30, moveNumber: 30, lineLength: 100 }),
  });
  expect(svg().querySelectorAll('[data-mistake]')).toHaveLength(0);
});

it('draws and names White’s numbers in White’s perspective', () => {
  useDeviceStore.getState().update({ perspective: 'white' });
  const nodes = line();
  nodes[42] = { ...nodes[42], stats: { winrate: 0.8, scoreLead: 6, visits: 200 } };
  useTrendStore.getState().setNodes(nodes);
  // A 154 px panel: 4 above the chart, which is 150 (jsdom measures the legend as 0).
  renderWithGame(<TrendGraph height={154} width={WIDTH} />, {
    snapshot: makeSnapshot({ revision: 1, lineIndex: 30, moveNumber: 30, lineLength: 100 }),
  });
  // The lone node at 42: Black's 80% is White's 20%, plotted from the top of a 116 px plot.
  const lone = svg().querySelector('circle[data-line="winrate"]')!;
  expect(Number(lone.getAttribute('cy'))).toBeCloseTo(12 + 0.8 * 116);
  fireEvent.mouseMove(svg(), { clientX: xOf(72), clientY: 40 });
  expect(screen.getByText(/^胜率 50\.5%/)).toBeInTheDocument();
  expect(screen.getByText('目差 +0.1')).toBeInTheDocument();
});

it('switches the perspective from the legend, and remembers it', async () => {
  useSettingsStore.getState().apply(storedSettings);
  useTrendStore.getState().setNodes(line());
  const { requests } = renderWithGame(<TrendGraph height={150} width={WIDTH} />, {
    snapshot: makeSnapshot({ revision: 1, lineIndex: 30, moveNumber: 30, lineLength: 100 }),
    answer: (request) =>
      request.type === 'settingsSet' ? { type: 'settings', settings: request.settings } : undefined,
  });
  const toggle = screen.getByRole('radiogroup', { name: '走势图视角' });
  expect(within(toggle).getByRole('radio', { name: '黑' })).toHaveAttribute('aria-checked', 'true');
  await act(async () => fireEvent.click(within(toggle).getByRole('radio', { name: '白' })));
  expect(within(toggle).getByRole('radio', { name: '白' })).toHaveAttribute('aria-checked', 'true');
  expect(useDeviceStore.getState().settings.perspective).toBe('white');
  expect(requests.filter((r) => r.type === 'settingsSet')).toEqual([]);
});

it('the_graph_keeps_the_chosen_colour', () => {
  useTrendStore.getState().setNodes(line());
  renderWithGame(<TrendGraph height={150} width={WIDTH} />, {
    snapshot: makeSnapshot({
      revision: 1,
      lineIndex: 30,
      moveNumber: 30,
      lineLength: 100,
      nextColor: 'white',
    }),
  });
  // White to play, and the graph still shows Black's 49.5% at move 72.
  fireEvent.mouseMove(svg(), { clientX: xOf(72), clientY: 40 });
  expect(screen.getByText(/^胜率 49\.5%/)).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: '走势图视角' })).toBeInTheDocument();
});

it('captures_show_in_the_legend', () => {
  useTrendStore.getState().setNodes(line());
  renderWithGame(<TrendGraph height={150} width={WIDTH} />, {
    snapshot: makeSnapshot({ revision: 1, lineIndex: 30, moveNumber: 30, captures: [3, 5] }),
  });
  expect(screen.getByTestId('trend-legend')).toHaveTextContent('提子 黑 3 白 5');
  // No middle dot anywhere in interface text (owner, 2026-11-23).
  expect(screen.getByTestId('trend-legend').textContent).not.toContain('·');
});

it('the score option shows the board count, and an even lead reads 均势', () => {
  useDeviceStore.getState().update({ scoreWithKomi: false });
  mount();
  fireEvent.mouseMove(svg(), { clientX: xOf(72), clientY: 40 });
  // Black's −0.1 with komi is +7.4 on the board (Chinese rules, komi 7.5).
  expect(screen.getByText('目差 +7.4')).toBeInTheDocument();
  useDeviceStore.getState().update({ scoreWithKomi: true });
  fireEvent.mouseMove(svg(), { clientX: xOf(30), clientY: 40 });
  expect(screen.getByText('目差 均势')).toBeInTheDocument();
});

it('a legend that wraps takes its room from the chart, so the toggle stays in view', () => {
  // Classic's narrow column wraps the captures and the black/white toggle onto a second line.
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.testid === 'trend-legend'
      ? ({ width: 300, height: 58, top: 0, left: 0, right: 300, bottom: 58 } as DOMRect)
      : rect.call(this);
  });
  mount();
  // The panel is 150 px: 4 above the chart, 58 for the legend, the rest for the chart.
  expect(svg().getAttribute('height')).toBe('88');
  expect(screen.getByRole('radiogroup', { name: '走势图视角' })).toBeInTheDocument();
  vi.restoreAllMocks();
});

const job = (
  state: JobProgress['state'],
  working: number | null,
  queued: number[],
): JobProgress => ({
  state,
  done: 0,
  total: 20,
  boostDone: 0,
  boostTotal: 3,
  working: working === null ? null : working.toString(16).padStart(16, '0'),
  queued: queued.map((i) => i.toString(16).padStart(16, '0')),
  etaSeconds: 20,
});

const cells = () => [...document.querySelectorAll('[data-strip] rect')];
const cell = (i: number) => document.querySelector(`[data-strip] rect[data-index="${i}"]`)!;

it('strip cells follow progress', () => {
  mount();
  // No job yet: no strip.
  expect(document.querySelector('[data-strip]')).toBeNull();
  const queued = Array.from({ length: 17 }, (_, k) => 43 + k);
  act(() => useJobStore.getState().apply(job('running', 41, queued)));
  // Solid with a result (0–40, 42, 60–100), green for the one searched, faint when queued.
  const kinds = cells().map((c) => c.getAttribute('data-cell'));
  expect(kinds.filter((k) => k === 'result')).toHaveLength(83);
  expect(kinds.filter((k) => k === 'queued')).toHaveLength(17);
  expect(cell(41)).toHaveAttribute('data-cell', 'working');
  expect(cell(41)).toHaveAttribute('fill', 'var(--engine-ok)');
  // Cells sit just under the 0% line, centred on their move.
  expect(Number(cell(30).getAttribute('y'))).toBeGreaterThan(150 - 4 - 22 - 1);
  const c30 = Number(cell(30).getAttribute('x')) + Number(cell(30).getAttribute('width')) / 2;
  expect(c30).toBeCloseTo(xOf(30), 0);
  // It stays, all solid where results are, once the job's status has gone.
  act(() => useJobStore.setState({ progress: null, doneUntil: null }));
  expect(cells().every((c) => c.getAttribute('data-cell') === 'result')).toBe(true);
});

it('boost cells stand taller', () => {
  mount();
  act(() => useJobStore.getState().apply(job('boosting', 72, [73, 90])));
  const height = (i: number) => Number(cell(i).getAttribute('height'));
  expect(height(72)).toBe(8);
  expect(height(73)).toBe(8);
  expect(height(90)).toBe(8);
  expect(cell(73)).toHaveAttribute('data-cell', 'boost');
  expect(height(60)).toBe(3);
  // Once done, they drop back: nothing stays behind to mark the swings.
  act(() => useJobStore.getState().apply(job('done', null, [])));
  expect(height(72)).toBe(3);
});

it('coverage strip maps progress keys to every matching slot on the selected line', () => {
  mount();
  const selected = line()
    .slice(0, 4)
    .map((n, i) => ({ ...n, stats: null, key: [null, 'working', 'queued', 'working'][i] }));
  act(() => {
    useTrendStore.getState().setNodes(selected);
    useJobStore.getState().apply({
      ...job('running', null, []),
      working: 'working',
      queued: ['another branch', 'queued'],
    });
  });
  expect(cells().map((c) => [c.getAttribute('data-index'), c.getAttribute('data-cell')])).toEqual([
    ['1', 'working'],
    ['2', 'queued'],
    ['3', 'working'],
  ]);
});

it('a new line invalidates queued scrubs and old slots until the replacement trend arrives', async () => {
  const { requests } = mount();
  fireEvent.mouseDown(svg(), { clientX: xOf(10), buttons: 1 });
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, lineRevision: 1 })));
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  fireEvent.mouseDown(svg(), { clientX: xOf(11), buttons: 1 });
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  expect(navigations(requests)).toEqual([]);
  act(() => useTrendStore.getState().setNodes(line(), 1));
  fireEvent.mouseDown(svg(), { clientX: xOf(12), buttons: 1 });
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  expect(navigations(requests)).toEqual([{ node: 212 }]);
});
