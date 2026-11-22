import { render } from '@testing-library/react';
import { createElement } from 'react';
import { expect, it } from 'vitest';
import type { ShownCandidate } from '../analysis/candidates';
import { BoardCanvas } from './BoardCanvas';
import { domCanvas } from './canvasFactory';
import { boardImage } from './snapshotImage';

const best: ShownCandidate = {
  move: { type: 'play', x: 3, y: 3 },
  rank: 1,
  tier: 'best',
  winrate: 0.54,
  scoreLead: 1.8,
  visits: 1240,
  loss: 0,
  played: false,
  pv: [],
};

it('board_image_is_twice_the_css_size_and_includes_discs', async () => {
  const { container } = render(
    createElement(BoardCanvas, {
      cssSize: 300,
      boardSize: 19,
      stones: Array.from({ length: 361 }, () => null),
      lastMove: null,
      candidates: [best],
    }),
  );
  const host = container.firstElementChild as HTMLElement;
  const made: HTMLCanvasElement[] = [];
  const bytes = await boardImage(host, (w, h) => {
    const canvas = domCanvas(w, h) as HTMLCanvasElement;
    made.push(canvas);
    return canvas;
  });
  expect(made).toHaveLength(1);
  expect([made[0].width, made[0].height]).toEqual([600, 600]);
  const ctx = made[0].getContext('2d') as unknown as {
    __getDrawCalls(): Array<{ type: string; props: { img: unknown } }>;
  };
  const drawn = ctx.__getDrawCalls().filter((c) => c.type === 'drawImage');
  // The wood and grid, the stones, and the discs, bottom to top.
  expect(drawn.map((c) => c.props.img)).toEqual([...host.querySelectorAll('canvas')]);
  expect(bytes).toBeInstanceOf(Uint8Array);
});
