import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { boardGeometry } from '../board/geometry';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { useTreeStore } from '../game/treeStore';
import { MainBoard } from '../layout/MainBoard';
import { EditRow } from './EditRow';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { resetScoringStore } from '../scoring/scoringStore';
import { resetMoveMoveStore, useMoveMoveStore } from './moveMoveStore';

beforeEach(() => {
  resetGameStore();
  resetScoringStore();
  resetMoveMoveStore();
  useTreeStore.setState({ tree: null });
});

const board = (
  <>
    <MainBoard rect={{ x: 0, y: 0, width: 400, height: 400 }} />
    <EditRow />
  </>
);
const surface = () => document.querySelector('[data-board] > div')!;
const at = (x: number, y: number) => {
  const { lines } = boardGeometry(400, 19);
  return { clientX: lines[x], clientY: lines[y] };
};
const edits = (requests: Request[]) =>
  requests.flatMap((r) => (r.type === 'gameEdit' ? [r.edit] : []));

function mount(answer?: (request: Request) => Response | Promise<Response> | undefined) {
  const snapshot = makeSnapshot({
    node: 22,
    lastMove: { type: 'play', x: 4, y: 3 },
    placed: [
      { point: { x: 4, y: 3 }, node: 22, number: 5, branchNumber: null },
      { point: { x: 6, y: 6 }, node: 21, number: 4, branchNumber: null },
    ],
  });
  snapshot.stones[3 * 19 + 4] = 'white';
  snapshot.stones[6 * 19 + 6] = 'black';
  return renderWithGame(board, { snapshot, answer });
}
const pickMove = async () => {
  fireEvent.contextMenu(surface(), at(4, 3));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '移动这一手' })));
};

it('offers moving only on the stone of the current move', () => {
  mount();
  fireEvent.contextMenu(surface(), at(6, 6));
  expect(screen.queryByRole('menuitem', { name: '移动这一手' })).toBeNull();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  fireEvent.contextMenu(surface(), at(4, 3));
  expect(screen.getByRole('menuitem', { name: '移动这一手' })).toBeVisible();
});

it('picks the new point and sends it', async () => {
  const { requests } = mount();
  await pickMove();
  expect(useMoveMoveStore.getState().picking).toBe('white');
  expect(screen.getByRole('status')).toHaveTextContent('点新位置');
  await act(async () => fireEvent.click(surface(), at(2, 8)));
  expect(edits(requests)).toEqual([
    { kind: 'moveLastMove', to: { x: 2, y: 8 }, allowIllegal: false },
  ]);
  expect(screen.queryByRole('status')).toBeNull();
});

it('Esc, the Cancel button and a right click end the picking', async () => {
  const { requests } = mount();
  await pickMove();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useMoveMoveStore.getState().picking).toBeNull();

  await pickMove();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(useMoveMoveStore.getState().picking).toBeNull();

  await pickMove();
  fireEvent.contextMenu(surface(), at(9, 9));
  expect(useMoveMoveStore.getState().picking).toBeNull();
  expect(screen.queryByRole('menuitem')).toBeNull();
  expect(edits(requests)).toEqual([]);
});

it('asks before making later moves illegal, then resends allowing it', async () => {
  const { requests } = mount((r) => {
    if (r.type === 'gameEdit' && r.edit.kind === 'moveLastMove' && !r.edit.allowIllegal)
      return Promise.reject({
        code: 'gameLaterMovesIllegal',
        message: '2 later moves would become illegal',
        detail: '2',
      });
  });
  await pickMove();
  await act(async () => fireEvent.click(surface(), at(2, 8)));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('后面有 2 手会变得不合法');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '移动' })));
  expect(edits(requests)).toEqual([
    { kind: 'moveLastMove', to: { x: 2, y: 8 }, allowIllegal: false },
    { kind: 'moveLastMove', to: { x: 2, y: 8 }, allowIllegal: true },
  ]);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('leaving the position drops the question about the move left behind', async () => {
  const { requests } = mount((r) => {
    if (r.type === 'gameEdit' && r.edit.kind === 'moveLastMove')
      return Promise.reject({ code: 'gameLaterMovesIllegal', message: '', detail: '1' });
  });
  await pickMove();
  await act(async () => fireEvent.click(surface(), at(2, 8)));
  expect(screen.getByRole('dialog')).toBeVisible();
  act(() => {
    const snapshot = useGameStore.getState().snapshot!;
    useGameStore.getState().apply({ ...snapshot, revision: snapshot.revision + 1, node: 21 });
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(edits(requests)).toHaveLength(1);
});

it('a second click while the move is on its way plays nothing', async () => {
  let reply!: (response: Response) => void;
  const { requests } = mount((r) => {
    if (r.type === 'gameEdit' && r.edit.kind === 'moveLastMove')
      return new Promise<Response>((resolve) => (reply = resolve));
  });
  await pickMove();
  await act(async () => fireEvent.click(surface(), at(2, 8)));
  await act(async () => fireEvent.click(surface(), at(2, 8)));
  expect(edits(requests)).toEqual([
    { kind: 'moveLastMove', to: { x: 2, y: 8 }, allowIllegal: false },
  ]);
  await act(async () =>
    reply({ type: 'game', snapshot: useGameStore.getState().snapshot!, warnings: [] }),
  );
  expect(useMoveMoveStore.getState().pending).toBeNull();
});

it('an edit such as an undo drops the question', async () => {
  mount((r) => {
    if (r.type === 'gameEdit' && r.edit.kind === 'moveLastMove')
      return Promise.reject({ code: 'gameLaterMovesIllegal', message: '', detail: '1' });
  });
  await pickMove();
  await act(async () => fireEvent.click(surface(), at(2, 8)));
  expect(screen.getByRole('dialog')).toBeVisible();
  act(() => {
    const snapshot = useGameStore.getState().snapshot!;
    useGameStore.getState().apply({
      ...snapshot,
      revision: snapshot.revision + 1,
      treeRevision: snapshot.treeRevision + 1,
    });
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});
