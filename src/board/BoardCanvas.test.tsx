import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShownCandidate } from '../analysis/candidates';
import type { Color } from '../transport/generated/Color';
import { BoardCanvas } from './BoardCanvas';
import { boardGeometry } from './geometry';
import * as stones from './stones';

vi.mock('./stones', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stones')>();
  return { ...actual, makeStoneSprites: vi.fn(actual.makeStoneSprites) };
});

function stubRatio(ratio: number) {
  vi.stubGlobal('devicePixelRatio', ratio);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const empty = (n: number): (Color | null)[] => Array.from({ length: n * n }, () => null);

function drawCalls(canvas: HTMLCanvasElement) {
  return (
    canvas.getContext('2d') as unknown as { __getDrawCalls(): Array<{ type: string }> }
  ).__getDrawCalls();
}

describe('BoardCanvas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(stones.makeStoneSprites).mockClear();
  });

  it('sizes every layer at the CSS size times the device pixel ratio', () => {
    stubRatio(2);
    const { container } = render(
      <BoardCanvas cssSize={400} boardSize={19} stones={empty(19)} lastMove={null} />,
    );
    const canvases = container.querySelectorAll('canvas');
    // Wood and grid, stones, the position estimate's squares, candidate discs.
    expect(canvases).toHaveLength(4);
    for (const canvas of canvases) {
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(800);
      expect(canvas.style.width).toBe('400px');
    }
    expect(drawCalls(canvases[0]).length).toBeGreaterThan(0);
  });

  it('draws nothing for a zero-size board and does not throw', () => {
    stubRatio(1.5);
    const { container } = render(
      <BoardCanvas cssSize={0} boardSize={19} stones={empty(19)} lastMove={null} />,
    );
    const canvases = container.querySelectorAll('canvas');
    expect(canvases[0].width).toBe(0);
    expect(drawCalls(canvases[0])).toHaveLength(0);
    expect(drawCalls(canvases[1])).toHaveLength(0);
  });

  it('stamps the stones on the upper layer and rebuilds sprites only for a new spacing or ratio', () => {
    stubRatio(1);
    const one = empty(9);
    one[40] = 'black';
    const { container, rerender } = render(
      <BoardCanvas cssSize={300} boardSize={9} stones={one} lastMove={null} />,
    );
    const upper = container.querySelectorAll('canvas')[1];
    expect(drawCalls(upper).filter((c) => c.type === 'drawImage')).toHaveLength(1);
    const two = [...one];
    two[0] = 'white';
    rerender(
      <BoardCanvas
        cssSize={300}
        boardSize={9}
        stones={two}
        lastMove={{ type: 'play', x: 0, y: 0 }}
      />,
    );
    expect(stones.makeStoneSprites).toHaveBeenCalledTimes(1);
    rerender(<BoardCanvas cssSize={320} boardSize={9} stones={two} lastMove={null} />);
    expect(stones.makeStoneSprites).toHaveBeenCalledTimes(2);
  });

  it('gives stones a contact shadow on wood only (UI polish design 3)', () => {
    stubRatio(1);
    const { rerender } = render(
      <BoardCanvas cssSize={300} boardSize={9} stones={empty(9)} lastMove={null} />,
    );
    expect(vi.mocked(stones.makeStoneSprites).mock.lastCall?.[4]).toBe(true);
    rerender(
      <BoardCanvas
        cssSize={300}
        boardSize={9}
        stones={empty(9)}
        lastMove={null}
        boardStyle="printed"
      />,
    );
    expect(vi.mocked(stones.makeStoneSprites).mock.lastCall?.[4]).toBe(false);
  });
});

describe('BoardCanvas hover square', () => {
  const square = (c: Element) => c.querySelector('[data-layer="hover-square"]');

  it('drops a point left over from another grid, and clears on a touch', () => {
    stubRatio(1);
    const props = { stones: empty(19), lastMove: null, hoverColor: 'black' as const };
    const { container, rerender } = render(<BoardCanvas cssSize={400} boardSize={19} {...props} />);
    const area = container.firstElementChild as HTMLElement;
    const g = boardGeometry(400, 19);
    fireEvent.mouseMove(area, { clientX: g.lines[15], clientY: g.lines[15] });
    expect(square(container)).not.toBeNull();
    // A 9×9 game opens under a still mouse: no square at a point the new board lacks.
    rerender(<BoardCanvas cssSize={400} boardSize={9} {...props} stones={empty(9)} />);
    expect(square(container)).toBeNull();
    rerender(<BoardCanvas cssSize={400} boardSize={19} {...props} orientation={1} />);
    expect(square(container)).toBeNull();
    fireEvent.mouseMove(area, { clientX: g.lines[4], clientY: g.lines[4] });
    expect(square(container)).not.toBeNull();
    fireEvent.pointerDown(area, { pointerType: 'touch', clientX: 5, clientY: 5 });
    expect(square(container)).toBeNull();
  });
});

describe('BoardCanvas candidates', () => {
  afterEach(() => vi.unstubAllGlobals());

  const best: ShownCandidate = {
    move: { type: 'play' as const, x: 3, y: 3 },
    rank: 1,
    tier: 'best' as const,
    winrate: 0.54,
    scoreLead: 1.8,
    visits: 1240,
    loss: 0,
    played: false,
    pv: [],
  };

  it('rings the record’s next move alone on the candidate layer', () => {
    stubRatio(1);
    const props = { cssSize: 400, boardSize: 19, stones: empty(19), lastMove: null };
    const { container } = render(
      <BoardCanvas {...props} candidates={[best]} nextRing={{ x: 9, y: 9 }} />,
    );
    const layer = container.querySelector<HTMLCanvasElement>('canvas[data-layer="candidates"]')!;
    const events = (
      layer.getContext('2d') as unknown as {
        __getEvents(): Array<{ type: string; props: { x: number } }>;
      }
    ).__getEvents();
    const g = boardGeometry(400, 19);
    const arcs = events.filter((e) => e.type === 'arc').map((e) => e.props.x);
    // The best disc's fill and ring, then the next move's ring alone.
    expect(arcs.at(-1)).toBeCloseTo(g.lines[9]);
  });

  it('draws the ownership squares on their own layer, between the stones and the discs', () => {
    stubRatio(1);
    const props = { cssSize: 400, boardSize: 19, stones: empty(19), lastMove: null };
    const owners = empty(19);
    owners[0] = 'black';
    owners[1] = 'white';
    const { container, rerender } = render(
      <BoardCanvas {...props} candidates={[best]} ownership={{ owners, dead: [] }} />,
    );
    const layers = [...container.querySelectorAll('canvas')].map((c) => c.dataset.layer ?? 'board');
    expect(layers.indexOf('ownership')).toBe(layers.indexOf('candidates') - 1);
    const layer = container.querySelector<HTMLCanvasElement>('canvas[data-layer="ownership"]')!;
    const fills = () =>
      (layer.getContext('2d') as unknown as { __getDrawCalls(): Array<{ type: string }> })
        .__getDrawCalls()
        .filter((c) => c.type === 'fillRect').length;
    expect(fills()).toBe(2);
    // Off again: the layer is cleared.
    rerender(<BoardCanvas {...props} candidates={[best]} ownership={null} />);
    const cleared = (
      layer.getContext('2d') as unknown as { __getEvents(): Array<{ type: string }> }
    )
      .__getEvents()
      .filter((e) => e.type === 'clearRect').length;
    expect(cleared).toBeGreaterThanOrEqual(2);
  });

  it('reports the hovered candidate when the pointer enters and leaves its disc', () => {
    stubRatio(1);
    const onHover = vi.fn();
    const { container } = render(
      <BoardCanvas
        cssSize={400}
        boardSize={19}
        stones={empty(19)}
        lastMove={null}
        candidates={[best]}
        onHoverCandidate={onHover}
      />,
    );
    const area = container.firstElementChild as HTMLElement;
    const g = boardGeometry(400, 19);
    fireEvent.mouseMove(area, { clientX: g.lines[3], clientY: g.lines[3] });
    fireEvent.mouseMove(area, { clientX: g.lines[3] + 1, clientY: g.lines[3] });
    fireEvent.mouseMove(area, { clientX: g.lines[5], clientY: g.lines[3] });
    fireEvent.mouseMove(area, { clientX: g.lines[3], clientY: g.lines[3] });
    fireEvent.mouseLeave(area);
    expect(onHover.mock.calls).toEqual([[best.move], [null], [best.move], [null]]);
  });

  it('hit-tests the discs where they are drawn with the coordinates hidden', () => {
    stubRatio(1);
    const onHover = vi.fn();
    const corner: ShownCandidate = { ...best, move: { type: 'play', x: 18, y: 18 } };
    const { container } = render(
      <BoardCanvas
        cssSize={400}
        boardSize={19}
        stones={empty(19)}
        lastMove={null}
        candidates={[corner]}
        coordinates={false}
        onHoverCandidate={onHover}
      />,
    );
    const area = container.firstElementChild as HTMLElement;
    const g = boardGeometry(400, 19, false);
    // Near the disc's outer edge, where the shown-coordinates layout would miss it.
    const x = g.lines[18] + g.stoneRadius * 0.9;
    fireEvent.mouseMove(area, { clientX: x, clientY: g.lines[18] });
    expect(onHover.mock.calls).toEqual([[corner.move]]);
  });

  it('reports the point clicked or tapped while points are asked for, and no candidate', () => {
    stubRatio(1);
    const onTapPoint = vi.fn();
    const onTapCandidate = vi.fn();
    const { container } = render(
      <BoardCanvas
        cssSize={400}
        boardSize={19}
        stones={empty(19)}
        lastMove={null}
        candidates={[best]}
        onTapCandidate={onTapCandidate}
        onTapPoint={onTapPoint}
      />,
    );
    const area = container.firstElementChild as HTMLElement;
    const g = boardGeometry(400, 19);
    // Within half a spacing of D16's lines (x 3, y 3), where a disc also sits.
    fireEvent.click(area, { clientX: g.lines[3] + g.spacing * 0.4, clientY: g.lines[3] });
    // Off the grid, in the coordinates' margin: nothing.
    fireEvent.click(area, { clientX: 1, clientY: 1 });
    const touch = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 };
    fireEvent.pointerDown(area, { ...touch, clientX: g.lines[18], clientY: g.lines[0] });
    fireEvent.pointerUp(area, { ...touch, clientX: g.lines[18], clientY: g.lines[0] });
    // The click a browser sends after the tap is not a second one.
    fireEvent.click(area, { clientX: g.lines[18], clientY: g.lines[0] });
    expect(onTapPoint.mock.calls).toEqual([[{ x: 3, y: 3 }], [{ x: 18, y: 0 }]]);
    expect(onTapCandidate).not.toHaveBeenCalled();
  });

  it('a reorder under a still pointer is not a new hover', () => {
    stubRatio(1);
    const onHover = vi.fn();
    const other: ShownCandidate = { ...best, move: { type: 'play', x: 5, y: 3 }, rank: 2 };
    const props = { cssSize: 400, boardSize: 19, stones: empty(19), lastMove: null };
    const { container, rerender } = render(
      <BoardCanvas {...props} candidates={[best, other]} onHoverCandidate={onHover} />,
    );
    const area = container.firstElementChild as HTMLElement;
    const g = boardGeometry(400, 19);
    fireEvent.mouseMove(area, { clientX: g.lines[5], clientY: g.lines[3] });
    rerender(
      <BoardCanvas
        {...props}
        candidates={[
          { ...other, rank: 1 },
          { ...best, rank: 2 },
        ]}
        onHoverCandidate={onHover}
      />,
    );
    fireEvent.mouseMove(area, { clientX: g.lines[5] + 1, clientY: g.lines[3] });
    expect(onHover.mock.calls).toEqual([[other.move]]);
  });
});

it('discs_wait_for_all_fonts', async () => {
  // M7 minor 10: every face the coordinates, discs and line numbers use.
  const load = vi.fn(async (face: string) => [face]);
  vi.stubGlobal('devicePixelRatio', 1);
  Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
  render(<BoardCanvas cssSize={400} boardSize={19} stones={empty(19)} lastMove={null} />);
  await act(async () => {});
  const faces = load.mock.calls.map(([face]) => face);
  for (const weight of ['400', '500', '600', '700'])
    expect(faces.some((f) => f.startsWith(`${weight} `) && f.endsWith('Inter'))).toBe(true);
  delete (document as { fonts?: unknown }).fonts;
  vi.unstubAllGlobals();
});

it('marked stones retain their labels and trial ring without overlapping move numbers', () => {
  const a = { x: 2, y: 2 },
    b = { x: 3, y: 3 },
    c = { x: 4, y: 4 };
  const status = empty(9);
  status[20] = 'black';
  status[30] = 'white';
  status[40] = 'black';
  const { container } = render(
    <BoardCanvas
      cssSize={400}
      boardSize={9}
      stones={status}
      lastMove={null}
      marks={[
        { point: a, mark: { kind: 'label', text: 'A' } },
        { point: b, mark: { kind: 'label', text: 'B' } },
      ]}
      numbers={[
        { point: a, n: 12 },
        { point: c, n: 13 },
      ]}
      tryoutNumbers={[{ point: b, n: 1 }]}
    />,
  );
  const calls = (layer: string) =>
    (
      container
        .querySelector<HTMLCanvasElement>(`[data-layer="${layer}"]`)!
        .getContext('2d') as unknown as {
        __getDrawCalls(): { type: string; props: { text?: string } }[];
      }
    ).__getDrawCalls();
  const labels = (layer: string) =>
    calls(layer)
      .filter((c) => c.type === 'fillText')
      .map((c) => c.props.text);
  expect(labels('marks')).toEqual(['A', 'B']);
  expect(labels('editing')).toEqual(['13']);
  expect(calls('editing').filter((c) => c.type === 'stroke')).toHaveLength(1);
});

it('a variation number leaves the saved label visible on a preview stone', () => {
  const saved = { x: 1, y: 1 },
    next = { x: 2, y: 2 };
  const status = empty(9);
  status[10] = 'black';
  status[20] = 'white';
  const { container } = render(
    <BoardCanvas
      cssSize={400}
      boardSize={9}
      stones={status}
      lastMove={null}
      marks={[{ point: saved, mark: { kind: 'label', text: 'A' } }]}
      variation={{
        numbers: [
          { point: saved, n: 1 },
          { point: next, n: 2 },
        ],
        newest: next,
      }}
    />,
  );
  const labels = (layer: string) =>
    (
      container
        .querySelector<HTMLCanvasElement>(`[data-layer="${layer}"]`)!
        .getContext('2d') as unknown as {
        __getDrawCalls(): { type: string; props: { text?: string } }[];
      }
    )
      .__getDrawCalls()
      .filter((c) => c.type === 'fillText')
      .map((c) => c.props.text);
  expect(labels('marks')).toEqual(['A']);
  expect(labels('candidates')).toEqual(['2']);
});

it('the last-move dot gives way to a mark on its stone and returns when the mark clears', () => {
  const point = { x: 1, y: 1 };
  const status = empty(9);
  status[10] = 'black';
  const props = {
    cssSize: 400,
    boardSize: 9,
    stones: status,
    lastMove: { type: 'play' as const, ...point },
  };
  const { container, rerender } = render(
    <BoardCanvas {...props} marks={[{ point, mark: { kind: 'cross' } }]} />,
  );
  const stoneLayer = container.querySelectorAll('canvas')[1];
  expect(drawCalls(stoneLayer).filter((c) => c.type === 'fill')).toHaveLength(0);
  rerender(<BoardCanvas {...props} />);
  expect(drawCalls(stoneLayer).filter((c) => c.type === 'fill')).toHaveLength(1);
});

it('rotated clicks resolve the logical intersection and offset badge', () => {
  const point = { x: 1, y: 2 };
  const onClickPoint = vi.fn(),
    onContextBadge = vi.fn();
  const badge = { point, letter: 'A', outlined: true, tryout: false };
  const { container } = render(
    <BoardCanvas
      cssSize={400}
      boardSize={9}
      orientation={1}
      stones={empty(9)}
      lastMove={null}
      badges={[badge]}
      onClickPoint={onClickPoint}
      onContextBadge={onContextBadge}
    />,
  );
  const { lines, spacing } = boardGeometry(400, 9);
  const surface = container.firstElementChild!;
  fireEvent.click(surface, { clientX: lines[6], clientY: lines[1] });
  expect(onClickPoint).toHaveBeenCalledWith(point);
  fireEvent.contextMenu(surface, {
    clientX: lines[6] + spacing * 0.42,
    clientY: lines[1] - spacing * 0.42,
  });
  expect(onContextBadge).toHaveBeenCalledWith(badge, expect.anything());
});

it('drags from and to logical points and abandons a drag when the view changes', () => {
  const status = empty(9);
  status[19] = 'black';
  const onDragStone = vi.fn();
  const props = { cssSize: 400, boardSize: 9, stones: status, lastMove: null, onDragStone };
  const { container, rerender } = render(<BoardCanvas {...props} orientation={1} />);
  const surface = container.firstElementChild!;
  const { lines } = boardGeometry(400, 9);
  const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 };
  const start = { ...pointer, clientX: lines[6], clientY: lines[1] };
  const end = { ...pointer, clientX: lines[5], clientY: lines[4] };
  for (const turn of [false, true]) {
    fireEvent.pointerDown(surface, start);
    fireEvent.pointerMove(surface, end);
    if (turn) rerender(<BoardCanvas {...props} orientation={2} />);
    fireEvent.pointerUp(surface, end);
  }
  expect(onDragStone.mock.calls).toEqual([
    [
      { x: 1, y: 2 },
      { x: 4, y: 3 },
    ],
  ]);
});
