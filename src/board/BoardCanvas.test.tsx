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

  it('fades the candidate layer while a new search catches up', () => {
    stubRatio(1);
    const props = { cssSize: 400, boardSize: 19, stones: empty(19), lastMove: null };
    const { container, rerender } = render(
      <BoardCanvas {...props} candidates={[best]} catchingUp />,
    );
    const layer = container.querySelector<HTMLCanvasElement>('canvas[data-layer="candidates"]')!;
    expect(layer).toHaveStyle({ opacity: '0.6' });
    expect(layer.style.transition).toBe('opacity 200ms');
    rerender(<BoardCanvas {...props} candidates={[best]} catchingUp={false} />);
    expect(layer).toHaveStyle({ opacity: '1' });
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
