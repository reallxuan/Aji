import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { boardGeometry } from '../board/geometry';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { MainBoard } from '../layout/MainBoard';
import { EditRow } from './EditRow';
import { useModeStore } from './modeStore';

const ui = (
  <>
    <EditRow touch />
    <MainBoard rect={{ x: 0, y: 0, width: 400, height: 400 }} />
  </>
);
const surface = () => document.querySelector('[data-board] > div')!;
const button = (name: string) => screen.getByRole('button', { name });
const point = { x: 3, y: 4 };
const dest = { x: 7, y: 8 };
const at = ({ x, y }: typeof point) => {
  const { lines } = boardGeometry(400, 19);
  return { clientX: lines[x], clientY: lines[y] };
};
const click = (name: string) => act(async () => fireEvent.click(button(name)));
const place = (p: typeof point) => act(async () => fireEvent.click(surface(), at(p)));
function mount() {
  const snapshot = makeSnapshot({ nextColor: 'white' });
  snapshot.stones[4 * 19 + 3] = 'black';
  const h = renderWithGame(ui, { snapshot });
  return () => h.requests.flatMap((r) => (r.type === 'gameEdit' ? [r.edit] : []));
}
beforeEach(() => {
  resetGameStore();
  useModeStore.setState({ mode: 'setup', setupTool: 'black' });
});
it('setup clicks add and remove stones', async () => {
  const edits = mount();
  await place(point);
  await place(dest);
  await click('放白子');
  await place(point);
  expect(edits()).toEqual([
    { kind: 'setupStone', point, stone: null },
    { kind: 'setupStone', point: dest, stone: 'black' },
    { kind: 'setupStone', point, stone: 'white' },
  ]);
});
it('alternate starts with the side to move', async () => {
  const edits = mount();
  await click('交替');
  await place(dest);
  await place({ x: 2, y: 2 });
  expect(edits().map((e) => e.kind === 'setupStone' && e.stone)).toEqual(['white', 'black']);
});
it.each(['touch', 'mouse'])('drag sends moveStone once for %s', async (pointerType) => {
  const edits = mount();
  const ptr = { pointerId: 1, pointerType, button: 0 };
  fireEvent.pointerDown(surface(), { ...ptr, ...at(point) });
  fireEvent.pointerMove(surface(), { ...ptr, ...at(dest) });
  expect(document.querySelector('[data-layer="drag-ghost"]')).toBeInTheDocument();
  await act(async () => fireEvent.pointerUp(surface(), { ...ptr, ...at(dest) }));
  await place(dest);
  expect(document.querySelector('[data-layer="drag-ghost"]')).toBeNull();
  expect(edits()).toEqual([{ kind: 'moveStone', from: point, to: dest }]);
});
it('a short touch places once and a 500 ms hold opens the setup stone menu', async () => {
  const edits = mount();
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  try {
    const ptr = { pointerId: 1, pointerType: 'touch', button: 0 };
    fireEvent.pointerDown(surface(), { ...ptr, ...at(dest) });
    act(() => vi.advanceTimersByTime(499));
    await act(async () => fireEvent.pointerUp(surface(), { ...ptr, ...at(dest) }));
    fireEvent.pointerDown(surface(), { ...ptr, ...at(point) });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(surface(), { ...ptr, ...at(point) });
    expect(screen.getByRole('menuitem', { name: '删除这颗子' })).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '改为白子' })));
    expect(edits()).toEqual([
      { kind: 'setupStone', point: dest, stone: 'black' },
      { kind: 'setupStone', point, stone: 'white' },
    ]);
  } finally {
    vi.useRealTimers();
  }
});
it('insert sends one insertMove then returns to black', async () => {
  const edits = mount();
  await click('插入一手');
  await place(dest);
  await place(point);
  expect(edits()).toEqual([
    { kind: 'insertMove', color: 'white', mv: { type: 'play', ...dest } },
    { kind: 'setupStone', point, stone: null },
  ]);
});
it('flatten asks nothing and is undoable from the row', async () => {
  const { requests } = renderWithGame(ui, {
    answer: (r) =>
      r.type === 'gameEdit' && r.edit.kind === 'flatten'
        ? { type: 'game', snapshot: makeSnapshot({ revision: 10, canUndo: true }), warnings: [] }
        : undefined,
  });
  expect(button('撤销')).toBeDisabled();
  await click('折叠为新局面');
  expect(requests).toContainEqual({ type: 'gameEdit', edit: { kind: 'flatten' } });
  expect(button('撤销')).toBeEnabled();
  await click('撤销');
  expect(requests).toContainEqual({ type: 'gameUndo' });
});
it('the to-play control and pass use record edits', async () => {
  const edits = mount();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /轮到.*白/ })));
  await click('停一手');
  expect(edits()).toEqual([{ kind: 'setToPlay', color: 'black' }, { kind: 'pass' }]);
});
it('two quick clicks use the board returned by the first setup edit', async () => {
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const snapshot = makeSnapshot();
  const { requests } = renderWithGame(ui, {
    snapshot,
    answer: (r) => {
      if (r.type === 'gameEdit' && r.edit.kind === 'setupStone' && r.edit.stone === 'black') {
        const next = makeSnapshot({ revision: 2, node: 1 });
        next.stones[4 * 19 + 3] = 'black';
        return first.then(() => ({ type: 'game', snapshot: next, warnings: [] }));
      }
    },
  });
  fireEvent.click(surface(), at(point));
  fireEvent.click(surface(), at(point));
  await act(async () => release());
  expect(requests.filter((r) => r.type === 'gameEdit').map((r) => r.edit)).toEqual([
    { kind: 'setupStone', point, stone: 'black' },
    { kind: 'setupStone', point, stone: null },
  ]);
});

it('navigation during a drag cancels the ghost and never moves a stone on the new board', async () => {
  const edits = mount();
  const ptr = { pointerId: 1, pointerType: 'touch', button: 0 };
  fireEvent.pointerDown(surface(), { ...ptr, ...at(point) });
  fireEvent.pointerMove(surface(), { ...ptr, ...at(dest) });
  const next = makeSnapshot({ revision: 2, node: 1 });
  next.stones[4 * 19 + 3] = 'white';
  act(() => useGameStore.getState().apply(next));
  expect(document.querySelector('[data-layer="drag-ghost"]')).toBeNull();
  await act(async () => fireEvent.pointerUp(surface(), { ...ptr, ...at(dest) }));
  expect(edits()).toEqual([]);
});

it.each(['same child', 'navigate', 'replace'])(
  'a refused insert retains only its validated setup visit: %s',
  async (action) => {
    const child = makeSnapshot({ revision: 2, node: 1 });
    child.stones[4 * 19 + 3] = 'black';
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reject!: () => void;
    const refusal = new Promise<never>((_, fail) => {
      reject = () => fail({ code: 'gameIllegalMove', message: 'occupied', detail: 'occupied' });
    });
    const { requests } = renderWithGame(ui, {
      answer: (r) => {
        if (r.type !== 'gameEdit') return;
        if (r.edit.kind === 'insertMove') return refusal;
        if (r.edit.kind === 'setupStone' && r.edit.point.x === point.x)
          return first.then(() => ({ type: 'game', snapshot: child, warnings: [] }));
      },
    });
    await place(point);
    await click('插入一手');
    await place(point);
    await place(dest);
    await act(async () => release());
    if (action !== 'same child') {
      act(() =>
        useGameStore.getState().apply({
          ...child,
          revision: 3,
          node: action === 'navigate' ? 2 : 1,
          gameRevision: action === 'replace' ? 3 : 0,
        }),
      );
    }
    await act(async () => reject());
    expect(requests.filter((r) => r.type === 'gameEdit').map((r) => r.edit)).toEqual([
      { kind: 'setupStone', point, stone: 'black' },
      { kind: 'insertMove', color: 'black', mv: { type: 'play', ...point } },
      ...(action === 'same child' ? [{ kind: 'setupStone', point: dest, stone: 'black' }] : []),
    ]);
  },
);

it.each(['pass', 'setToPlay'])(
  'queued alternate runs begin with the acknowledged %s side and retain their own sequence',
  async (kind) => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { requests } = renderWithGame(ui, {
      answer: (r) =>
        r.type === 'gameEdit' && r.edit.kind === kind
          ? first.then(() => ({
              type: 'game',
              snapshot: makeSnapshot({ revision: 2, node: 1, nextColor: 'white' }),
              warnings: [],
            }))
          : undefined,
    });
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: kind === 'pass' ? '停一手' : /轮到.*黑/ }),
      ),
    );
    await click('交替');
    await place(point);
    await place(dest);
    await place({ x: 2, y: 2 });
    await click('放黑子');
    await place({ x: 1, y: 1 });
    await click('交替');
    await place({ x: 3, y: 3 });
    await act(async () => release());
    await place({ x: 5, y: 5 });
    expect(
      requests.flatMap((r) =>
        r.type === 'gameEdit' && r.edit.kind === 'setupStone' ? [r.edit.stone] : [],
      ),
    ).toEqual(['white', 'black', 'white', 'black', 'white', 'black']);
  },
);
