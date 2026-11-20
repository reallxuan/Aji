import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Color } from '../transport/generated/Color';
import { BoardCanvas } from './BoardCanvas';
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

  it('sizes both layers at the CSS size times the device pixel ratio', () => {
    stubRatio(2);
    const { container } = render(
      <BoardCanvas cssSize={400} boardSize={19} stones={empty(19)} lastMove={null} />,
    );
    const canvases = container.querySelectorAll('canvas');
    expect(canvases).toHaveLength(2);
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
