// @vitest-environment node
//
// Draws boards with Skia (@napi-rs/canvas) and compares them with the PNGs in __screenshots__.
// `UPDATE_SCREENSHOTS=1 pnpm test src/board/screenshots` writes the baselines instead. They guard
// against regressions in the drawing code; the exit check looks at the real WebView.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { tierFor, type ShownCandidate } from '../analysis/candidates';
import type { Color } from '../transport/generated/Color';
import type { DiscField } from '../transport/generated/DiscField';
import type { Move } from '../transport/generated/Move';
import type { CanvasFactory, OffscreenCanvasLike } from './canvasFactory';
import { type BoardView, drawBoard } from './drawBoard';
import { drawCandidates } from './candidates';
import { boardGeometry } from './geometry';
import { drawStones, makeStoneSprites } from './stones';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINES = join(HERE, '__screenshots__');
const UPDATE = process.env.UPDATE_SCREENSHOTS === '1';
/** Board CSS size for every shot. */
const CSS_SIZE = 560;
/** The most pixels that may differ, as a share of the image. */
const TOLERANCE = 0.001;

const skia: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as OffscreenCanvasLike;

/** Samsung Cup 2025, final, game 2 (public domain), after move 58: W at H18. */
const SAMSUNG_58 = [
  '...................',
  '.XO..O.OX..........',
  '..XO.XOOOXXO.O.....',
  '.XXOOOXOX...OXXXX..',
  'X.XO.XXOX.X..OXO...',
  '.XO..XOX........X..',
  '.OO...O.X.O..O.....',
  '...................',
  '...................',
  '...................',
  '...................',
  '...................',
  '...................',
  '..X................',
  '................X..',
  '...X..........O....',
  '.....O.........O...',
  '...................',
  '...................',
];

function parse(rows: string[]): (Color | null)[] {
  return rows.flatMap((row) =>
    [...row].map((c) => (c === 'X' ? 'black' : c === 'O' ? 'white' : null)),
  );
}

function render(
  view: BoardView,
  stones: (Color | null)[],
  lastMove: Move | null,
  discs: { candidates: ShownCandidate[]; lines: [DiscField, DiscField] } | null = null,
): PNG {
  const size = Math.round(view.cssSize * view.dpr);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  drawBoard(ctx, view, skia);
  const upper = createCanvas(size, size);
  const sprites = makeStoneSprites(
    boardGeometry(view.cssSize, view.boardSize).spacing,
    view.dpr,
    skia,
  );
  drawStones(
    upper.getContext('2d') as unknown as CanvasRenderingContext2D,
    view,
    stones,
    lastMove,
    sprites,
  );
  ctx.drawImage(upper as unknown as CanvasImageSource, 0, 0);
  if (discs) {
    const layer = createCanvas(size, size);
    drawCandidates(
      layer.getContext('2d') as unknown as CanvasRenderingContext2D,
      view,
      discs.candidates,
      discs.lines,
      'zh-CN',
    );
    ctx.drawImage(layer as unknown as CanvasImageSource, 0, 0);
  }
  return PNG.sync.read(canvas.toBuffer('image/png'));
}

function compare(name: string, actual: PNG) {
  const file = join(BASELINES, `${name}.png`);
  if (UPDATE) {
    mkdirSync(BASELINES, { recursive: true });
    writeFileSync(file, PNG.sync.write(actual));
    return;
  }
  expect(existsSync(file), `${name}.png: run with UPDATE_SCREENSHOTS=1`).toBe(true);
  const expected = PNG.sync.read(readFileSync(file));
  expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
  const differing = pixelmatch(actual.data, expected.data, undefined, actual.width, actual.height, {
    threshold: 0.1,
  });
  expect(
    differing / (actual.width * actual.height),
    `${name}: ${differing} pixels differ`,
  ).toBeLessThanOrEqual(TOLERANCE);
}

/**
 * The mockup's candidates for Black at move 59 (board-analysis.html, section 1): win rate and
 * lead are Black's, Black being to move. M13 was played.
 */
const MOCKUP = [
  { at: [10, 5], w: 54.2, s: 1.8, v: 1240 },
  { at: [11, 6], w: 53.1, s: 1.3, v: 842, played: true },
  { at: [9, 7], w: 52.4, s: 0.9, v: 512 },
  { at: [15, 9], w: 50.9, s: 0.2, v: 203 },
  { at: [2, 9], w: 49.6, s: -0.4, v: 96 },
  { at: [12, 8], w: 48.8, s: -0.9, v: 41 },
];

function mockupDiscs(
  at: (i: number) => [number, number] = (i) => MOCKUP[i].at as [number, number],
) {
  return MOCKUP.map((c, i): ShownCandidate => {
    const [x, y] = at(i);
    const loss = MOCKUP[0].w - c.w;
    return {
      move: { type: 'play', x, y },
      rank: i + 1,
      tier: tierFor(loss, i === 0),
      winrate: c.w / 100,
      scoreLead: c.s,
      visits: c.v,
      loss,
      played: c.played ?? false,
      pv: [],
    };
  });
}

const empty = (n: number): (Color | null)[] => Array.from({ length: n * n }, () => null);

describe('board screenshots', () => {
  beforeAll(() => {
    GlobalFonts.registerFromPath(join(HERE, '../assets/fonts/Inter-Regular.woff2'), 'Inter');
    GlobalFonts.registerFromPath(join(HERE, '../assets/fonts/Inter-Medium.woff2'), 'Inter');
  });

  for (const boardSize of [9, 13, 19]) {
    it(`draws an empty ${boardSize}×${boardSize} board`, () => {
      compare(
        `empty-${boardSize}`,
        render({ cssSize: CSS_SIZE, dpr: 1, boardSize }, empty(boardSize), null),
      );
    });
  }

  for (const dpr of [1, 2]) {
    it(`draws the Samsung game at move 58 at ratio ${dpr}`, () => {
      const lastMove: Move = { type: 'play', x: 7, y: 1 };
      compare(
        `samsung-58@${dpr}x`,
        render({ cssSize: CSS_SIZE, dpr, boardSize: 19 }, parse(SAMSUNG_58), lastMove),
      );
    });
  }

  const SAMSUNG_LAST: Move = { type: 'play', x: 7, y: 1 };

  it('draws candidate discs in four tiers, with the played ring', () => {
    compare(
      'discs-tiers@2x',
      render({ cssSize: CSS_SIZE, dpr: 2, boardSize: 19 }, parse(SAMSUNG_58), SAMSUNG_LAST, {
        candidates: mockupDiscs(),
        lines: ['winrate', 'scoreLead'],
      }),
    );
  });

  it('draws visits over win rate when the settings ask for it', () => {
    compare(
      'discs-visits',
      render({ cssSize: CSS_SIZE, dpr: 1, boardSize: 19 }, parse(SAMSUNG_58), SAMSUNG_LAST, {
        candidates: mockupDiscs(),
        lines: ['visits', 'winrate'],
      }),
    );
  });

  const SMALL: Record<number, Array<[number, number]>> = {
    9: [
      [2, 2],
      [6, 6],
      [4, 4],
      [2, 6],
      [6, 2],
      [4, 2],
    ],
    5: [
      [1, 1],
      [3, 3],
      [2, 2],
      [1, 3],
      [3, 1],
      [2, 0],
    ],
  };
  for (const boardSize of [9, 5]) {
    it(`draws discs on a ${boardSize}×${boardSize} board`, () => {
      compare(
        `discs-${boardSize}`,
        render({ cssSize: CSS_SIZE, dpr: 1, boardSize }, empty(boardSize), null, {
          candidates: mockupDiscs((i) => SMALL[boardSize][i]),
          lines: ['winrate', 'scoreLead'],
        }),
      );
    });
  }
});
