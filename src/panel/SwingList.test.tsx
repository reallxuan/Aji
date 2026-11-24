import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetTrendStore, useTrendStore } from '../analysis/trendStore';
import { resetDeviceStore, useDeviceStore } from '../device/deviceStore';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import type { Loss } from '../transport/generated/Loss';
import type { TrendNode } from '../transport/generated/TrendNode';
import { SwingList } from './SwingList';

afterEach(() => {
  resetGameStore();
  resetTrendStore();
  resetDeviceStore();
});

const SWINGS: Record<number, Loss> = {
  3: { winrate: 12, score: 1 },
  4: { winrate: 8, score: -0.5 },
  5: { winrate: 6, score: 4 },
  9: { winrate: 7, score: 2.5 },
};

/** Twelve nodes; Black plays the odd moves. Nodes from `analysedTo` on have no result. */
function line(losses: Record<number, Loss> = SWINGS, analysedTo = 12): TrendNode[] {
  return Array.from({ length: 12 }, (_, i) => {
    const analysed = i < analysedTo;
    return {
      node: i,
      key: i.toString(16).padStart(16, '0'),
      moveNumber: i,
      mover: i === 0 ? null : i % 2 ? 'black' : 'white',
      move: i === 0 ? null : { type: 'play', x: i, y: 3 },
      stats: analysed ? { winrate: 0.5, scoreLead: 0, visits: 100 } : null,
      loss:
        i === 0 || !analysed || i >= analysedTo ? null : (losses[i] ?? { winrate: 1, score: 0 }),
    };
  });
}

function mount(nodes: TrendNode[] = line(), lineIndex = 6) {
  useTrendStore.getState().setNodes(nodes, 1);
  return renderWithGame(<SwingList />, {
    snapshot: makeSnapshot({ revision: 1, lineIndex, moveNumber: lineIndex, lineLength: 11 }),
  });
}

const side = (name: '黑' | '白') => screen.getByRole('region', { name });
const row = (move: number) => document.querySelector(`[data-swing-row="${move}"]`) as HTMLElement;
const moves = (name: '黑' | '白') =>
  within(side(name))
    .queryAllByRole('button')
    .map((b) => Number(b.dataset.swingRow));

it('lists each side’s swings over 5%, biggest first, with both losses', () => {
  mount();
  expect(moves('黑')).toEqual([3, 9, 5]);
  expect(moves('白')).toEqual([4]);
  expect(within(side('黑')).getByText('3 手')).toBeInTheDocument();
  expect(row(3)).toHaveTextContent('3D16−12.0%−1.0');
  // A score gain reads as one.
  expect(row(4)).toHaveTextContent('4E16−8.0%+0.5');
});

it('the controls change what counts, and are remembered on the device', async () => {
  mount();
  fireEvent.click(screen.getByRole('radio', { name: '目差' }));
  expect(useDeviceStore.getState().settings.swingBy).toBe('score');
  // Over 2 points by score: only moves 5 and 9.
  expect(moves('黑')).toEqual([5, 9]);
  fireEvent.change(screen.getByRole('textbox', { name: '波动阈值' }), { target: { value: '3' } });
  expect(useDeviceStore.getState().settings.swingThreshold).toEqual({ winrate: 5, score: 3 });
  expect(moves('黑')).toEqual([5]);
  fireEvent.click(screen.getByRole('checkbox', { name: '仅后续' }));
  expect(useDeviceStore.getState().settings.swingAfterOnly).toBe(true);
  // At move 6, move 5 is behind.
  expect(moves('黑')).toEqual([]);
  expect(within(side('黑')).getByText('没有')).toBeInTheDocument();
});

it('click_goes_to_the_position_before', async () => {
  const { requests } = mount();
  await act(async () => {
    fireEvent.click(row(5));
  });
  expect(requests).toContainEqual({ type: 'gameNavigate', to: { move: 4 } });
});

it('current_move_row_is_highlighted', () => {
  mount(line(), 4);
  expect(row(4)).toHaveAttribute('data-current');
  expect(row(3)).not.toHaveAttribute('data-current');
});

it('partial_results_show_the_footer', () => {
  mount(line(SWINGS, 8));
  expect(moves('黑')).toEqual([3, 5]);
  expect(
    screen.getByText('只有 8 个局面有结果，部分手还没法比较。分析全局后列表才完整。'),
  ).toBeInTheDocument();
});

it('no_results_show_the_empty_state', () => {
  mount(line(SWINGS, 1));
  expect(screen.getByText('还没有可比较的结果')).toBeInTheDocument();
  expect(screen.getByText(/从棋局菜单选“分析全局…”/)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '黑' })).toBeNull();
});

it('a whole game of results has no footer', () => {
  mount();
  expect(screen.queryByText(/只有/)).toBeNull();
});
