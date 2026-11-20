import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardCanvas } from './BoardCanvas';

function stubRatio(ratio: number) {
  vi.stubGlobal('devicePixelRatio', ratio);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('BoardCanvas', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sizes the backing store at the CSS size times the device pixel ratio', () => {
    stubRatio(2);
    const { container } = render(<BoardCanvas cssSize={400} boardSize={19} />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(800);
    expect(canvas.style.width).toBe('400px');
    const draws = (
      canvas.getContext('2d') as unknown as { __getDrawCalls(): unknown[] }
    ).__getDrawCalls();
    expect(draws.length).toBeGreaterThan(0);
  });

  it('draws nothing for a zero-size board and does not throw', () => {
    stubRatio(1.5);
    const { container } = render(<BoardCanvas cssSize={0} boardSize={19} />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(0);
    const draws = (
      canvas.getContext('2d') as unknown as { __getDrawCalls(): unknown[] }
    ).__getDrawCalls();
    expect(draws).toHaveLength(0);
  });
});
