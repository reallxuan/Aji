import { createI18n } from '../i18n/createI18n';
import { useReplayStore } from '../game/replayStore';
import { connectReplay } from '../game/actions';
import { useViewStore } from '../analysis/viewStore';
import { useFreehandStore } from './freehandStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { candidate, play, subBoardHarness } from '../analysis/subBoardTesting';
import { boardGeometry } from '../board/geometry';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { MainBoard } from '../layout/MainBoard';
import { CandidateTable } from '../panel/CandidateTable';
import { HeaderPanel } from '../panel/HeaderPanel';
import { useModeStore } from './modeStore';

const board = <MainBoard rect={{ x: 0, y: 0, width: 400, height: 400 }} />;
const ui = (
  <>
    <HeaderPanel />
    {board}
  </>
);
const at = (x: number, y: number) => {
  const { lines } = boardGeometry(400, 19);
  return { clientX: lines[x], clientY: lines[y] };
};
const surface = () => document.querySelector('[data-board] > div')!;
const button = (name: string) => screen.getByRole('button', { name });
const click = async (name: string) => act(async () => fireEvent.click(button(name)));
const point = { x: 3, y: 4 };
beforeEach(() => {
  resetGameStore();
  useModeStore.setState({ mode: 'normal', markupTool: 'triangle' });
});
it('marks from the file are drawn outside markup mode, underneath candidate discs', () => {
  renderWithGame(board, {
    snapshot: makeSnapshot({ marks: [{ point, mark: { kind: 'label', text: 'X' } }] }),
  });
  const layer = document.querySelector<HTMLCanvasElement>('[data-layer="marks"]');
  expect(layer).toBeInTheDocument();
  expect(layer!.compareDocumentPosition(document.querySelector('[data-layer="candidates"]')!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const ctx = layer!.getContext('2d') as unknown as {
    __getDrawCalls(): { type: string; props: { text: string } }[];
  };
  expect(ctx.__getDrawCalls()).toContainEqual(
    expect.objectContaining({ type: 'fillText', props: expect.objectContaining({ text: 'X' }) }),
  );
});
it('a second click with the same tool removes the mark; letters and numbers take the next free value', async () => {
  const { requests } = renderWithGame(ui, {
    snapshot: makeSnapshot({
      marks: [
        { point, mark: { kind: 'triangle' } },
        { point: { x: 1, y: 1 }, mark: { kind: 'label', text: 'A' } },
        { point: { x: 2, y: 2 }, mark: { kind: 'label', text: '1' } },
      ],
    }),
  });
  await click('标记');
  for (const [name, x, y, mark] of [
    ['三角', 3, 4, null],
    ['字母', 2, 2, { kind: 'label', text: 'B' }],
    ['数字', 1, 1, { kind: 'label', text: '2' }],
    ['数字', 2, 2, null],
    ['字母', 1, 1, null],
  ] as const) {
    await click(name);
    await act(async () => fireEvent.click(surface(), at(x, y)));
    expect(requests.filter((r) => r.type === 'gameEdit').at(-1)).toEqual({
      type: 'gameEdit',
      edit: { kind: 'setMark', node: 0, point: { x, y }, mark },
    });
  }
  await click('清除标记');
  expect(requests.at(-1)).toEqual({ type: 'gameEdit', edit: { kind: 'clearMarks', node: 0 } });
});
it('discs hide while marking and the candidate table keeps updating', () => {
  const h = subBoardHarness();
  render(
    <>
      {board}
      <CandidateTable />
    </>,
    { wrapper: h.wrapper },
  );
  act(() => useModeStore.getState().setMode('markup'));
  h.analyse([candidate(0, 0.52, [play(1)])]);
  expect(screen.getByText('B16')).toBeVisible();
  h.analyse([candidate(0, 0.53, [play(2)])]);
  expect(screen.getByText('C16')).toBeVisible();
  const ctx = document
    .querySelector<HTMLCanvasElement>('[data-layer="candidates"]')!
    .getContext('2d') as unknown as { __getDrawCalls(): { type: string }[] };
  expect(ctx.__getDrawCalls().some((e) => e.type === 'fillText')).toBe(false);
});
it('freehand takes phone swipes and clears on navigation, replacement at the same node, and explicit clear', async () => {
  const { requests } = renderWithGame(ui);
  await click('标记');
  await click('涂鸦');
  const draw = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-layer="freehand"]')!;
    const ptr = { pointerId: 5, pointerType: 'touch', button: 0 };
    fireEvent.pointerDown(canvas, { ...ptr, ...at(5, 5) });
    fireEvent.pointerMove(canvas, { ...ptr, ...at(2, 4) });
    fireEvent.pointerUp(canvas, { ...ptr, ...at(1, 4) });
  };
  const strokes = () => useFreehandStore.getState().strokes;
  draw();
  expect(strokes()).toHaveLength(1);
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, comment: 'updated' })));
  expect(strokes()).toHaveLength(1);
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 3, node: 1 })));
  expect(strokes()).toHaveLength(0);
  draw();
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 4, node: 1, gameRevision: 4 })));
  expect(strokes()).toHaveLength(0);
  draw();
  await click('清除涂鸦');
  expect(strokes()).toHaveLength(0);
  expect(requests.filter((r) => r.type === 'gameEdit' || r.type === 'gameNavigate')).toEqual([]);
});

it('a cancelled drawing leaves the next pointer free to draw', async () => {
  renderWithGame(ui);
  await click('标记');
  await click('涂鸦');
  const canvas = document.querySelector('[data-layer="freehand"]')!;
  const pointer = { pointerId: 4, pointerType: 'pen', button: 0, ...at(1, 1) };
  fireEvent.pointerDown(canvas, pointer);
  fireEvent.pointerMove(canvas, { ...pointer, ...at(2, 3) });
  fireEvent.pointerCancel(canvas, pointer);
  fireEvent.pointerDown(canvas, { ...pointer, pointerId: 7 });
  fireEvent.pointerUp(canvas, { ...pointer, pointerId: 7, ...at(4, 4) });
  expect(useFreehandStore.getState().strokes).toHaveLength(1);
});

/** Hold the first mark RPC while further physical input arrives. */
function delayedMarkup() {
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  let snapshot = makeSnapshot();
  const h = renderWithGame(ui, {
    snapshot,
    answer: (req) => {
      if (req.type !== 'gameEdit') return;
      const e = req.edit;
      if (e.kind !== 'setMark' && e.kind !== 'clearMarks') return;
      count++;
      return (async () => {
        if (count === 1) await first;
        let marks =
          e.kind === 'clearMarks'
            ? []
            : snapshot.marks.filter((m) => m.point.x !== e.point.x || m.point.y !== e.point.y);
        if (e.kind === 'setMark' && e.mark) marks = [...marks, { point: e.point, mark: e.mark }];
        snapshot = { ...snapshot, revision: snapshot.revision + 1, marks };
        return { type: 'game' as const, snapshot, warnings: [] };
      })();
    },
  });
  return { ...h, release };
}
it('rapid markup clicks and clear use each acknowledged mark in input order', async () => {
  const { requests, release } = delayedMarkup();
  await click('标记');
  await click('字母');
  fireEvent.click(surface(), at(1, 1));
  fireEvent.click(surface(), at(2, 2));
  fireEvent.click(surface(), at(2, 2));
  fireEvent.click(button('清除标记'));
  fireEvent.click(surface(), at(3, 3));
  await act(async () => release());
  expect(
    requests.flatMap((r) =>
      r.type === 'gameEdit' ? [r.edit.kind === 'setMark' ? r.edit.mark : r.edit.kind] : [],
    ),
  ).toEqual([
    { kind: 'label', text: 'A' },
    { kind: 'label', text: 'B' },
    null,
    'clearMarks',
    { kind: 'label', text: 'A' },
  ]);
});
it.each(['navigate', 'replace', 'navigate back'])(
  'drops queued markup after %s before an acknowledgement',
  async (action) => {
    const { requests, release } = delayedMarkup();
    await click('标记');
    fireEvent.click(surface(), at(1, 1));
    fireEvent.click(surface(), at(2, 2));
    await act(async () => {
      useGameStore.getState().apply(
        makeSnapshot({
          revision: 10,
          node: action === 'replace' ? 0 : 7,
          gameRevision: action === 'replace' ? 10 : 0,
        }),
      );
      if (action === 'navigate back') useGameStore.getState().apply(makeSnapshot({ revision: 11 }));
      release();
    });
    expect(requests.filter((r) => r.type === 'gameEdit')).toHaveLength(1);
  },
);

it('a stroke keeps its fractional logical points when the view turns', async () => {
  renderWithGame(ui);
  await click('标记');
  await click('涂鸦');
  act(() => useViewStore.setState({ orientation: 1 }));
  const { margin, spacing } = boardGeometry(400, 19);
  const canvas = document.querySelector<HTMLCanvasElement>('[data-layer="freehand"]')!;
  const touch = {
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    clientX: margin + 5.5 * spacing,
    clientY: margin + 7.25 * spacing,
  };
  fireEvent.pointerDown(canvas, touch);
  fireEvent.pointerUp(canvas, touch);
  const [p] = useFreehandStore.getState().strokes[0];
  expect(p.x).toBeCloseTo(7.25);
  expect(p.y).toBeCloseTo(12.5);
  act(() => useViewStore.setState({ orientation: 0 }));
  const ctx = canvas.getContext('2d')!;
  expect(ctx.arc).toHaveBeenLastCalledWith(
    margin + 7.25 * spacing,
    margin + 12.5 * spacing,
    1.5,
    0,
    2 * Math.PI,
  );
});

it('clearing a freehand drawing interrupts replay without sending a record edit', async () => {
  const { transport, files, requests } = renderWithGame(ui, {
    snapshot: makeSnapshot({ atEnd: false }),
  });
  await click('标记');
  await click('涂鸦');
  const disconnect = connectReplay({ transport, files, t: createI18n('en').t });
  try {
    await click('自动播放');
    expect(useReplayStore.getState().playing).toBe(true);
    await click('清除涂鸦');
    expect(useReplayStore.getState().playing).toBe(false);
    expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([]);
  } finally {
    act(disconnect);
  }
});
