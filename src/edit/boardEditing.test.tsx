import { createFakeGame } from '../dev/fakeGame';
import { connectReplay } from '../game/actions';
import { createI18n } from '../i18n/createI18n';
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetScoringStore, useScoringStore } from '../scoring/scoringStore';
import { boardGeometry } from '../board/geometry';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { MainBoard } from '../layout/MainBoard';
import { HeaderPanel } from '../panel/HeaderPanel';
import { useTreeStore } from '../game/treeStore';
import { resetEstimateStore, useEstimateStore } from '../analysis/estimateStore';
import { HOVER_SQUARE } from '../board/BoardCanvas';
import { OWNER_SQUARE } from '../board/ownership';
import { useModeStore } from './modeStore';

beforeEach(() => {
  resetGameStore();
  resetScoringStore();
  useTreeStore.setState({ tree: null });
});
const at = (x: number, y: number) => {
  const { lines } = boardGeometry(400, 19);
  return { clientX: lines[x], clientY: lines[y] };
};
const board = <MainBoard rect={{ x: 0, y: 0, width: 400, height: 400 }} />;
const surface = () => document.querySelector('[data-board] > div')!;
it('header shows try-out and modified tags, guards modes at root zero and exposes history', () => {
  renderWithGame(<HeaderPanel />, {
    snapshot: makeSnapshot({ tryout: 0, changed: true, canUndo: true }),
  });
  for (const name of ['标记', '摆子']) expect(screen.getByRole('button', { name })).toBeDisabled();
  expect(screen.getByRole('button', { name: '试下' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();
  expect(screen.getByText('试下中')).toBeVisible();
  expect(screen.getByText('已修改')).toBeVisible();
});

it('the edit row switches the position estimate, with its key in the hint', () => {
  resetEstimateStore();
  renderWithGame(<HeaderPanel />, { snapshot: makeSnapshot({ tryout: 0 }) });
  const button = screen.getByRole('button', { name: '形势判断' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(button).toHaveAttribute('title', '形势判断（T）');
  // Try-out does not lock it: it is a view, not a board mode.
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(useEstimateStore.getState().on).toBe(true);
  expect(button).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(button);
  expect(useEstimateStore.getState().on).toBe(false);
});

it('a click on a stone does nothing, and its menu navigates to its placing node', async () => {
  const snapshot = makeSnapshot({
    placed: [{ point: { x: 4, y: 3 }, node: 22, number: 5, branchNumber: null }],
  });
  snapshot.stones[3 * 19 + 4] = 'black';
  const { requests } = renderWithGame(board, { snapshot });
  fireEvent.click(surface(), at(4, 3));
  expect(requests.filter((r) => r.type === 'gameEdit' || r.type === 'gameNavigate')).toEqual([]);
  fireEvent.contextMenu(surface(), at(4, 3));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: /回到这一手.*5/ })));
  expect(requests).toContainEqual({ type: 'gameNavigate', to: { node: 22 } });
});

it('the empty-point menu starts try-out and plays the selected point', async () => {
  const { requests } = renderWithGame(board);
  fireEvent.contextMenu(surface(), at(2, 7));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '在这里试下' })));
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([
    { type: 'gameEdit', edit: { kind: 'tryoutStart' } },
    { type: 'gameEdit', edit: { kind: 'play', mv: { type: 'play', x: 2, y: 7 } } },
  ]);
});

it('the try-out stone menu keeps the selected stone’s line', async () => {
  const snapshot = makeSnapshot({
    tryout: 0,
    placed: [{ point: { x: 4, y: 3 }, node: 7, number: 1, branchNumber: null }],
  });
  snapshot.stones[3 * 19 + 4] = 'black';
  useTreeStore.setState({
    tree: {
      revision: 0,
      nodes: [
        { id: 0, parent: null, color: null, mv: null, flags: 4 },
        { id: 7, parent: 0, color: 'black', mv: { type: 'play', x: 4, y: 3 }, flags: 2 },
      ],
    },
  });
  const { requests } = renderWithGame(board, { snapshot });
  fireEvent.contextMenu(surface(), at(4, 3));
  expect(screen.getByRole('menuitem', { name: /结束试下/ })).toBeEnabled();
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '保留为分支' })));
  expect(requests).toContainEqual({ type: 'gameEdit', edit: { kind: 'tryoutKeep', node: 7 } });
});

it('a badge tap selects the continuation by node even outside its intersection', async () => {
  const snapshot = makeSnapshot({
    continuations: [
      { node: 21, mv: { type: 'play', x: 3, y: 3 }, tryout: false },
      { node: 40, mv: { type: 'play', x: 5, y: 4 }, tryout: false },
    ],
  });
  const { requests } = renderWithGame(board, { snapshot });
  const { lines, spacing } = boardGeometry(400, 19);
  const touch = {
    pointerType: 'touch',
    pointerId: 1,
    clientX: lines[5] + spacing * 0.57,
    clientY: lines[4] - spacing * 0.56,
  };
  fireEvent.pointerDown(surface(), touch);
  await act(async () => fireEvent.pointerUp(surface(), touch));
  expect(requests).toContainEqual({ type: 'gameNavigate', to: { node: 40 } });
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([]);
});

it('a setup stone offers move numbers and has no placing-node action', async () => {
  const snapshot = makeSnapshot({
    placed: [{ point: { x: 6, y: 4 }, node: 3, number: 3, branchNumber: null }],
  });
  snapshot.stones[3 * 19 + 4] = 'black';
  snapshot.stones[4 * 19 + 6] = 'white';
  renderWithGame(board, { snapshot });
  fireEvent.contextMenu(surface(), at(4, 3));
  expect(screen.queryByRole('menuitem', { name: /回到这一手/ })).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示手数' })),
  );
  const canvas = document.querySelector<HTMLCanvasElement>('[data-layer="editing"]');
  expect(canvas).toBeInTheDocument();
  const ctx = canvas!.getContext('2d') as unknown as {
    __getDrawCalls(): { type: string; props: { text: string } }[];
  };
  expect(ctx.__getDrawCalls().some((c) => c.type === 'fillText' && c.props.text === '3')).toBe(
    true,
  );
});

const duplicateMove = { type: 'play', x: 3, y: 3 } as const;
// (;SZ[19](;B[dd]C[first])(;B[dd]C[second]))
const duplicateChildren = [
  { node: 21, mv: duplicateMove, tryout: false },
  { node: 40, mv: duplicateMove, tryout: false },
];
function duplicateBoard() {
  useTreeStore.setState({
    tree: {
      revision: 0,
      nodes: [
        { id: 0, parent: null, color: null, mv: null, flags: 4 },
        ...duplicateChildren.map((c) => ({
          id: c.node,
          parent: 0,
          color: 'black' as const,
          mv: c.mv,
          flags: 1,
        })),
      ],
    },
  });
  return renderWithGame(board, { snapshot: makeSnapshot({ continuations: duplicateChildren }) });
}
const badgeAtD16 = () => {
  const g = boardGeometry(400, 19);
  return { clientX: g.lines[3] + g.spacing * 0.43, clientY: g.lines[3] - g.spacing * 0.43 };
};
it.each(['mouse', 'touch'])(
  'duplicate B[dd] siblings offer each node on a %s badge activation',
  async (input) => {
    const { requests } = duplicateBoard();
    const point = badgeAtD16();
    if (input === 'mouse') fireEvent.click(surface(), point);
    else {
      const touch = { ...point, pointerType: 'touch', pointerId: 1 };
      fireEvent.pointerDown(surface(), touch);
      fireEvent.pointerUp(surface(), touch);
    }
    expect(requests.filter((r) => r.type === 'gameNavigate')).toEqual([]);
    const a = screen.getByRole('menuitem', { name: '分支 A' });
    const b = screen.getByRole('menuitem', { name: '分支 B' });
    await act(async () => fireEvent.click(input === 'mouse' ? a : b));
    expect(requests).toContainEqual({
      type: 'gameNavigate',
      to: { node: input === 'mouse' ? 21 : 40 },
    });
  },
);
it('badge context editing selects the second of two B[dd] siblings by its ID', async () => {
  const { requests } = duplicateBoard();
  fireEvent.contextMenu(surface(), badgeAtD16());
  const b = screen.getByRole('menuitem', { name: '分支 B' });
  fireEvent.keyDown(b, { key: 'ArrowRight' });
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '上移一位' })));
  expect(requests).toContainEqual({ type: 'gameEdit', edit: { kind: 'moveUp', node: 40 } });
});
it('starting final scoring dismisses the open board menu and blocks taps until the trial has ended', async () => {
  const { requests } = renderWithGame(board, { snapshot: makeSnapshot({ tryout: 0 }) });
  fireEvent.contextMenu(surface(), at(4, 4));
  expect(screen.getByRole('menuitem', { name: '停一手' })).toBeVisible();
  act(() => useScoringStore.setState({ starting: true }));
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(surface(), at(9, 9));
  const touch = { ...at(3, 4), pointerType: 'touch', pointerId: 1 };
  fireEvent.pointerDown(surface(), touch);
  fireEvent.pointerUp(surface(), touch);
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([]);
  act(() => useScoringStore.setState({ starting: false }));
  expect(screen.queryByRole('menu')).toBeNull();
});

it('a board click in the same turn that scoring starts cannot queue a kept move', async () => {
  const { requests } = renderWithGame(board, { snapshot: makeSnapshot({ tryout: 0 }) });
  await act(async () => {
    useScoringStore.setState({ starting: true });
    fireEvent.click(surface(), at(8, 8));
  });
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([]);
});

it('try here skips its pending play when scoring starts before the start reply', async () => {
  const { requests } = renderWithGame(board, {
    answer: (request) => {
      if (request.type === 'gameEdit' && request.edit.kind === 'tryoutStart') {
        useScoringStore.setState({ starting: true });
        return { type: 'game', warnings: [], snapshot: makeSnapshot({ tryout: 0, revision: 2 }) };
      }
    },
  });
  fireEvent.contextMenu(surface(), at(4, 4));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '在这里试下' })));
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([
    { type: 'gameEdit', edit: { kind: 'tryoutStart' } },
  ]);
});

it('an occupied-stone click pauses replay without issuing a second action', async () => {
  const snapshot = makeSnapshot({ atEnd: false });
  snapshot.stones[3 * 19 + 4] = 'black';
  const { transport, files, requests } = renderWithGame(
    <>
      <HeaderPanel />
      {board}
    </>,
    { snapshot },
  );
  const disconnect = connectReplay({ transport, files, t: createI18n('en').t });
  try {
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '自动播放' })));
    expect(screen.getByRole('button', { name: '暂停自动播放' })).toBeEnabled();
    await act(async () => fireEvent.click(surface(), at(4, 3)));
    expect(screen.getByRole('button', { name: '自动播放' })).toBeEnabled();
    expect(requests.filter((r) => r.type === 'gameEdit' || r.type === 'gameNavigate')).toEqual([]);
  } finally {
    act(disconnect);
  }
});

it.each(['click', 'pointer', 'frame'] as const)(
  'a delayed replay advance never moves a %s action to the following node',
  async (input) => {
    vi.useFakeTimers();
    const service = createFakeGame(() => {});
    const root = service({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: false });
    if (root?.type !== 'game') throw Error('expected a game');
    let deliver!: () => void;
    const { transport, files, requests } = renderWithGame(
      <>
        <HeaderPanel />
        {board}
      </>,
      {
        snapshot: root.snapshot,
        answer(request) {
          const result = service(request);
          if (request.type === 'gameNavigate' && request.to === 'next' && result)
            return new Promise((resolve) => {
              deliver = () => resolve(result);
            });
          return result ?? undefined;
        },
      },
    );
    const disconnect = connectReplay({ transport, files, t: createI18n('en').t });
    try {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '自动播放' })));
      await act(async () => vi.advanceTimersByTimeAsync(1500));
      const next = service({ type: 'gameSnapshot' });
      if (next?.type !== 'game') throw Error('expected a game');
      expect(next.snapshot.node).not.toBe(root.snapshot.node);
      expect(useGameStore.getState().snapshot?.node).toBe(root.snapshot.node);
      const pos = { button: 0, pointerType: 'mouse', pointerId: 7, ...at(1, 1) };
      if (input === 'click') fireEvent.click(surface(), pos);
      else if (input === 'pointer') fireEvent.pointerDown(surface(), pos);
      else fireEvent.click(screen.getByRole('button', { name: '下一手' }), { detail: 0 });
      await act(async () => deliver());
      if (input === 'pointer') {
        fireEvent.pointerUp(surface(), pos);
        fireEvent.click(surface(), pos);
      }
      await act(async () => vi.advanceTimersByTimeAsync(30));
      expect(requests.filter((r) => r.type === 'gameEdit' || r.type === 'gameNavigate')).toEqual([
        { type: 'gameNavigate', to: 'next' },
      ]);
      expect(service({ type: 'gameSnapshot' })).toEqual(next);
    } finally {
      act(disconnect);
      vi.useRealTimers();
    }
  },
);

describe('the square under the mouse', () => {
  const square = () => document.querySelector<HTMLElement>('[data-layer="hover-square"]');
  const move = (x: number, y: number) => fireEvent.mouseMove(surface(), at(x, y));
  beforeEach(() => useModeStore.setState({ mode: 'normal', setupTool: 'black' }));

  it('shows the side to move on an empty point, and nothing on a stone or off the board', () => {
    const snapshot = makeSnapshot({ nextColor: 'white' });
    snapshot.stones[3 * 19 + 4] = 'black';
    renderWithGame(board, { snapshot });
    move(2, 7);
    expect(square()).toHaveAttribute('data-color', 'white');
    move(4, 3);
    expect(square()).toBeNull();
    move(2, 7);
    fireEvent.mouseLeave(surface());
    expect(square()).toBeNull();
  });

  it('is larger than a territory square', () => {
    expect(HOVER_SQUARE).toBeGreaterThan(OWNER_SQUARE);
  });

  it('is hidden in markup and follows the setup tool', async () => {
    renderWithGame(board, { snapshot: makeSnapshot({ nextColor: 'black' }) });
    act(() => useModeStore.setState({ mode: 'markup' }));
    move(2, 7);
    expect(square()).toBeNull();
    act(() => useModeStore.getState().setMode('setup'));
    act(() => useModeStore.getState().setSetupTool('white'));
    move(3, 7);
    expect(square()).toHaveAttribute('data-color', 'white');
    act(() => useModeStore.getState().setSetupTool('alternate'));
    move(2, 7);
    expect(square()).toHaveAttribute('data-color', 'black');
    act(() => void useModeStore.getState().takeAlternateColor('black'));
    expect(square()).toHaveAttribute('data-color', 'white');
  });
});
