// @vitest-environment node
//
// Draws boards with Skia (@napi-rs/canvas) and compares them with the PNGs in __screenshots__.
// `UPDATE_SCREENSHOTS=1 pnpm test src/board/screenshots` writes the baselines instead. They guard
// against regressions in the drawing code; the exit check looks at the real WebView.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { tierFor, type ShownCandidate } from '../analysis/candidates';
import { variationBoard } from '../analysis/variation';
import type { Color } from '../transport/generated/Color';
import type { DiscField } from '../transport/generated/DiscField';
import type { Move } from '../transport/generated/Move';
import type { CanvasFactory, OffscreenCanvasLike } from './canvasFactory';
import { type BoardView, drawBoard } from './drawBoard';
import { drawCandidates, drawNextRing, drawVariationNumbers } from './candidates';
import { drawOwnership, scoredOwnership, type Settled, settledOwnership } from './ownership';
import { C5, finishedStones, H4 } from '../scoring/testing';
import { drawMarks } from './marks';
import type { Mark } from '../transport/generated/Mark';
import { drawEditOverlay } from './badges';
import { boardGeometry } from './geometry';
import { drawStones, makeStoneSprites } from './stones';
import type { BoardId, StoneId } from '../device/deviceSettings';
import { channel, setGrainMap } from './grainMaps';
import type { GrainMapId } from './styles';

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
  overlay: ((ctx: CanvasRenderingContext2D) => void) | null = null,
  stoneStyle: StoneId = 'slate',
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
    stoneStyle,
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
  if (overlay) {
    const layer = createCanvas(size, size);
    overlay(layer.getContext('2d') as unknown as CanvasRenderingContext2D);
    ctx.drawImage(layer as unknown as CanvasImageSource, 0, 0);
  }
  return PNG.sync.read(canvas.toBuffer('image/png'));
}

/**
 * The position estimate over `stones` (P2 M2 design 5.7): the board, the stones with the dead ones
 * faded, then the settled points' squares.
 */
function renderOwnership(
  view: BoardView,
  stones: (Color | null)[],
  ownership: number[] | Settled,
  stoneStyle: StoneId,
): PNG {
  const size = Math.round(view.cssSize * view.dpr);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  drawBoard(ctx, view, skia);
  const settled = Array.isArray(ownership) ? settledOwnership(ownership, stones) : ownership;
  const upper = createCanvas(size, size);
  const sprites = makeStoneSprites(
    boardGeometry(view.cssSize, view.boardSize).spacing,
    view.dpr,
    skia,
    stoneStyle,
  );
  drawStones(
    upper.getContext('2d') as unknown as CanvasRenderingContext2D,
    view,
    stones,
    null,
    sprites,
    settled.dead,
  );
  ctx.drawImage(upper as unknown as CanvasImageSource, 0, 0);
  const squares = createCanvas(size, size);
  drawOwnership(
    squares.getContext('2d') as unknown as CanvasRenderingContext2D,
    view,
    settled.owners,
  );
  ctx.drawImage(squares as unknown as CanvasImageSource, 0, 0);
  return PNG.sync.read(canvas.toBuffer('image/png'));
}

/**
 * A made-up ownership for the Samsung position, in bands: Black's left side, White's right side,
 * Black's bottom middle, and an unsettled top middle. Every White stone in the left band and Black
 * stone in the right band stands in the other side's area, so it reads as dead.
 */
const OWNERSHIP_58 = Array.from({ length: 361 }, (_, i) => {
  const [x, y] = [i % 19, Math.floor(i / 19)];
  if (x <= 5) return 110;
  if (x >= 13) return -110;
  if (y >= 12) return 90;
  return y <= 6 ? 30 : 0;
});

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
  beforeAll(async () => {
    GlobalFonts.registerFromPath(join(HERE, '../assets/fonts/Inter-Regular.woff2'), 'Inter');
    GlobalFonts.registerFromPath(join(HERE, '../assets/fonts/Inter-Medium.woff2'), 'Inter');
    // The bundled grain maps, decoded by Skia as the app's webview would.
    for (const id of ['honey', 'kaya', 'walnut'] as GrainMapId[]) {
      const image = await loadImage(readFileSync(join(HERE, `../assets/wood/${id}.jpg`)));
      const ctx = createCanvas(image.width, image.height).getContext('2d');
      ctx.drawImage(image, 0, 0);
      setGrainMap(id, channel(ctx.getImageData(0, 0, image.width, image.height).data), image.width);
    }
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

  /**
   * The record's next move at G10, which KataGo did not list (P2 M2 design 5.6): a pale disc of
   * its own with the played ring. M13 is then an ordinary candidate.
   */
  it('next-move-disc: an unlisted next move gets a disc with the played ring', () => {
    const discs = mockupDiscs().map((c) => ({ ...c, played: false }));
    const next: ShownCandidate = {
      move: { type: 'play', x: 6, y: 9 },
      rank: discs.length + 1,
      tier: tierFor(7.2, false),
      winrate: 0.47,
      scoreLead: -0.6,
      visits: 320,
      loss: 7.2,
      played: true,
      pv: [],
    };
    compare(
      'next-move-disc@2x',
      render({ cssSize: CSS_SIZE, dpr: 2, boardSize: 19 }, parse(SAMSUNG_58), SAMSUNG_LAST, {
        candidates: [...discs, next],
        lines: ['winrate', 'scoreLead'],
      }),
    );
  });

  it('next-move-ring: without a result, or with the candidates hidden, the ring alone', () => {
    const view = { cssSize: CSS_SIZE, dpr: 2, boardSize: 19 };
    compare(
      'next-move-ring@2x',
      render(view, parse(SAMSUNG_58), SAMSUNG_LAST, null, (ctx) =>
        drawNextRing(ctx, view, { x: 6, y: 9 }),
      ),
    );
  });

  it('ownership-honey-light: settled points get squares, dead stones fade under them', () => {
    compare(
      'ownership-honey-light@2x',
      renderOwnership(
        { cssSize: CSS_SIZE, dpr: 2, boardSize: 19, style: 'honey' },
        parse(SAMSUNG_58),
        OWNERSHIP_58,
        'slate',
      ),
    );
  });

  it('ownership-walnut-dark: the same on the dark board', () => {
    compare(
      'ownership-walnut-dark@2x',
      renderOwnership(
        { cssSize: CSS_SIZE, dpr: 2, boardSize: 19, style: 'walnut' },
        parse(SAMSUNG_58),
        OWNERSHIP_58,
        'yunzi',
      ),
    );
  });

  it('final-scoring-9x9: the mockup game counted, C5 and H4 dead, dame bare', () => {
    // The backend's owners for it (area, after removing the two dead stones).
    const owners = [
      'XXXXOOOOO',
      'XXXXOOOOO',
      'XXXXOOOOO',
      'XXXXOOOOO',
      'XXXXXOOOO',
      'XXXXXOOOO',
      'XXXXXXOOO',
      'XXXXOOOOO',
      'XXXXOOOOO',
    ];
    const stones = finishedStones();
    compare(
      'final-scoring-9x9@2x',
      renderOwnership(
        { cssSize: 520, dpr: 2, boardSize: 9, style: 'honey' },
        stones,
        scoredOwnership(parse(owners), stones, [C5, H4]),
        'slate',
      ),
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

  it('rotated_board_with_numbers', () => {
    const view: BoardView = { cssSize: CSS_SIZE, dpr: 1, boardSize: 9, orientation: 1 };
    const stones = empty(9);
    const numbers = [
      { point: { x: 1, y: 2 }, n: 1 },
      { point: { x: 5, y: 7 }, n: 2 },
    ];
    stones[19] = 'black';
    stones[68] = 'white';
    compare(
      'rotated_board_with_numbers',
      render(view, stones, null, null, (ctx) =>
        drawEditOverlay(ctx, view, stones, [], [], numbers),
      ),
    );
  });

  it('badges_and_tryout_numbers', () => {
    const view = { cssSize: CSS_SIZE, dpr: 2, boardSize: 19 };
    const stones = parse(SAMSUNG_58);
    const draws = {
      candidates: mockupDiscs(),
      lines: ['winrate', 'scoreLead'] as [DiscField, DiscField],
    };
    const badges = [
      { point: { x: 2, y: 8 }, letter: 'A', outlined: true, tryout: false },
      { point: { x: 10, y: 5 }, letter: 'B', outlined: false, tryout: false },
      { point: { x: 14, y: 7 }, letter: 'C', outlined: true, tryout: true },
    ];
    const numbers = [
      { point: { x: 3, y: 15 }, n: 57 },
      { point: { x: 7, y: 1 }, n: 58 },
    ];
    compare(
      'badges_and_tryout_numbers',
      render(view, stones, null, draws, (ctx) =>
        drawEditOverlay(ctx, view, stones, badges, numbers),
      ),
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

  // The mockup's line for the best candidate, L14 (board-analysis.html, section 2).
  const COLUMNS = 'ABCDEFGHJKLMNOPQRST';
  const point = (label: string) => ({
    x: COLUMNS.indexOf(label[0]),
    y: 19 - Number(label.slice(1)),
  });
  const L14_LINE = ['L14', 'M13', 'M14', 'N13', 'L12', 'M12', 'K12', 'N12'].map(point);

  for (const step of [8, 3]) {
    it(`draws a hovered line as numbered stones, ${step === 8 ? 'in full' : 'three moves in'}`, () => {
      const view = { cssSize: CSS_SIZE, dpr: 2, boardSize: 19 };
      const board = variationBoard(
        parse(SAMSUNG_58),
        19,
        {
          moves: L14_LINE.map((p) => ({ type: 'play' as const, ...p })),
          colors: L14_LINE.map((_, i) => (i % 2 ? 'white' : 'black')),
          captured: L14_LINE.map(() => []),
          illegalAt: null,
        },
        step,
      );
      const image = render(view, board.stones, null, null, (ctx) =>
        drawVariationNumbers(ctx, view, board.numbers, board.newest, board.stones),
      );
      compare(`variation-${step === 8 ? 'full' : 'step-3'}@2x`, image);
    });
  }

  // The sets of P2 M1 design 5.7, beside honey and slate above (whose baselines are Phase 1's).
  const SET_SHOTS: Array<[BoardId, StoneId]> = [
    ['kaya', 'yunzi'],
    ['walnut', 'slate'],
    ['printed', 'flat'],
  ];
  for (const [board, stones] of SET_SHOTS) {
    it(`draws the ${board} board with ${stones} stones`, () => {
      compare(
        `set-${board}-${stones}`,
        render(
          { cssSize: CSS_SIZE, dpr: 1, boardSize: 19, style: board },
          parse(SAMSUNG_58),
          SAMSUNG_LAST,
          { candidates: mockupDiscs(), lines: ['winrate', 'scoreLead'] },
          null,
          stones,
        ),
      );
    });
  }

  const luminance = (png: PNG, x: number, y: number) => {
    const i = (y * png.width + x) * 4;
    return 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
  };
  /** How many pixels differ between two renders inside `box` (x0, y0, x1, y1). */
  const changed = (
    a: PNG,
    b: PNG,
    [x0, y0, x1, y1]: number[],
    skip: (x: number, y: number) => boolean = () => false,
  ) => {
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (skip(x, y)) continue;
        const i = (y * a.width + x) * 4;
        if ([0, 1, 2].some((k) => Math.abs(a.data[i + k] - b.data[i + k]) > 2)) n++;
      }
    return n;
  };

  it('walnut draws light coordinates', () => {
    const image = render(
      { cssSize: CSS_SIZE, dpr: 1, boardSize: 19, style: 'walnut' },
      empty(19),
      null,
    );
    const g = boardGeometry(CSS_SIZE, 19);
    const band = Math.floor(g.labelBand);
    let brightest = 0;
    for (let y = 0; y < band; y++)
      for (let x = band; x < CSS_SIZE - band; x++)
        brightest = Math.max(brightest, luminance(image, x, y));
    // Between lines, the wood is dark (about 80); the labels are cream, well above it.
    const mid = Math.round((g.lines[9] + g.lines[10]) / 2);
    const wood = luminance(image, mid, mid);
    expect(wood).toBeLessThan(110);
    expect(brightest - wood).toBeGreaterThan(60);
  });

  for (const [board, shadow] of [
    ['printed', false],
    ['honey', true],
  ] as const) {
    it(`${board} ${shadow ? 'shadows' : 'has no shadow under'} the best disc`, () => {
      const view = { cssSize: CSS_SIZE, dpr: 1, boardSize: 19, style: board };
      const discs = {
        candidates: mockupDiscs().slice(0, 1),
        lines: ['winrate', 'scoreLead'] as [DiscField, DiscField],
      };
      const bare = render(view, empty(19), null);
      const withDisc = render(view, empty(19), null, discs);
      const g = boardGeometry(CSS_SIZE, 19);
      const [cx, cy] = [g.lines[10], g.lines[5]].map(Math.round);
      const r = Math.ceil(g.stoneRadius);
      // Just below the disc, where only the shadow can reach.
      const below = changed(bare, withDisc, [cx - 4, cy + r + 2, cx + 4, cy + r + 6]);
      if (shadow) expect(below).toBeGreaterThan(0);
      else expect(below).toBe(0);
    });
  }

  it('flat stones have no shadow pixels outside the outline', () => {
    const view = { cssSize: CSS_SIZE, dpr: 1, boardSize: 19, style: 'printed' as const };
    const stones = empty(19);
    stones[9 * 19 + 9] = 'black';
    const bare = render(view, empty(19), null, null, null, 'flat');
    const withStone = render(view, stones, null, null, null, 'flat');
    const g = boardGeometry(CSS_SIZE, 19);
    const c = Math.round(g.lines[9]);
    // The outline is centred on the stone's edge; nothing may reach a pixel past it.
    const reach = g.stoneRadius + Math.max(1, g.stoneRadius * 0.07) / 2 + 1;
    const inside = (x: number, y: number) => Math.hypot(x + 0.5 - c, y + 0.5 - c) <= reach;
    const R = Math.ceil(g.stoneRadius * 2);
    expect(changed(bare, withStone, [c - R, c - R, c + R, c + R], inside)).toBe(0);
  });

  it('marks_on_stones_and_empty_points', () => {
    const view = { cssSize: CSS_SIZE, dpr: 1, boardSize: 9 };
    const stones = empty(9);
    const kinds: Mark[] = [
      { kind: 'triangle' },
      { kind: 'square' },
      { kind: 'circle' },
      { kind: 'cross' },
      { kind: 'label', text: 'A' },
      { kind: 'label', text: '1' },
    ];
    const marks = [2, 4, 6].flatMap((y, row) =>
      kinds.map((mark, index) => {
        const x = index + 1;
        stones[y * 9 + x] = row === 0 ? 'black' : row === 1 ? 'white' : null;
        return { point: { x, y }, mark };
      }),
    );
    compare(
      'marks_on_stones_and_empty_points',
      render(view, stones, null, null, (ctx) => drawMarks(ctx, marks, view, stones)),
    );
  });
});
