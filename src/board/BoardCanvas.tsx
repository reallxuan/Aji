import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { sameMove, type ShownCandidate } from '../analysis/candidates';
import { CATCHING_UP_FADE_MS, CATCHING_UP_OPACITY } from '../analysis/constants';
import type { Color } from '../transport/generated/Color';
import type { DiscField } from '../transport/generated/DiscField';
import type { Move } from '../transport/generated/Move';
import type { Point } from '../transport/generated/Point';
import { candidateAt, drawCandidates, drawVariationNumbers } from './candidates';
import { domCanvas } from './canvasFactory';
import { drawBoard } from './drawBoard';
import { boardGeometry } from './geometry';
import { drawStones, makeStoneSprites } from './stones';
import { useDevicePixelRatio } from './useDevicePixelRatio';

export interface BoardCanvasProps {
  /** The board's side in CSS pixels. */
  cssSize: number;
  /** Lines per side. */
  boardSize: number;
  /** Every point, row by row (`y * boardSize + x`). */
  stones: readonly (Color | null)[];
  lastMove: Move | null;
  /** Candidate discs to draw over the stones; none when absent. */
  candidates?: readonly ShownCandidate[];
  /** The discs' two lines (settings `discLines`). */
  discLines?: [DiscField, DiscField];
  /** The interface language, for the discs' numbers. */
  lang?: string;
  /** A new search is still below the cached depth: the discs are faded (design 5.2). */
  catchingUp?: boolean;
  /** The pointer entered a disc (its move) or left every disc (`null`). */
  onHoverCandidate?(move: Move | null): void;
  /**
   * The move the store holds as hovered on the board, so a hover ended elsewhere (a new
   * position) starts again on the next pointer move over a disc.
   */
  hoveredCandidate?: Move | null;
  /**
   * A hovered line's move numbers (design 5.8). While set, the numbers are drawn in place of the
   * discs, which still answer the pointer so the hover holds; `stones` are the line's board.
   */
  variation?: { numbers: ReadonlyArray<{ point: Point; n: number }>; newest: Point | null } | null;
}

const NO_CANDIDATES: readonly ShownCandidate[] = [];
const DEFAULT_LINES: [DiscField, DiscField] = ['winrate', 'scoreLead'];

/**
 * The board surface, `cssSize` CSS pixels square: the wood and grid on one canvas, the stones on
 * a second above it, the candidate discs on a third, each redrawn when what it shows changes.
 * Backing stores follow the device pixel ratio, so lines and stones stay sharp on any display.
 */
export function BoardCanvas({
  cssSize,
  boardSize,
  stones,
  lastMove,
  candidates = NO_CANDIDATES,
  discLines = DEFAULT_LINES,
  lang = 'en',
  catchingUp = false,
  onHoverCandidate,
  hoveredCandidate,
  variation = null,
}: BoardCanvasProps) {
  const board = useRef<HTMLCanvasElement>(null);
  const stoneLayer = useRef<HTMLCanvasElement>(null);
  const candidateLayer = useRef<HTMLCanvasElement>(null);
  const hovered = useRef<Move | null>(null);
  const dpr = useDevicePixelRatio();
  // Coordinates are drawn in Inter; redraw once the bundled font has loaded.
  const [fontsLoaded, setFontsLoaded] = useState(0);

  useEffect(() => {
    let active = true;
    document.fonts?.load('12px Inter').then(
      () => {
        if (active) setFontsLoaded((n) => n + 1);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const ctx = board.current?.getContext('2d');
    if (ctx) drawBoard(ctx, { cssSize, dpr, boardSize });
  }, [cssSize, dpr, boardSize, fontsLoaded]);

  const spacing = boardGeometry(cssSize, boardSize).spacing;
  // Drawing a stone with its gradients and shadows is slow; each look is drawn once per
  // spacing and ratio, then stamped.
  const sprites = useMemo(() => makeStoneSprites(spacing, dpr, domCanvas), [spacing, dpr]);

  useEffect(() => {
    const ctx = stoneLayer.current?.getContext('2d');
    if (ctx && cssSize > 0) drawStones(ctx, { cssSize, dpr, boardSize }, stones, lastMove, sprites);
  }, [cssSize, dpr, boardSize, stones, lastMove, sprites]);

  const [first, second] = discLines;
  useEffect(() => {
    const ctx = candidateLayer.current?.getContext('2d');
    if (!ctx) return;
    const view = { cssSize, dpr, boardSize };
    if (variation) drawVariationNumbers(ctx, view, variation.numbers, variation.newest, stones);
    else drawCandidates(ctx, view, candidates, [first, second], lang);
  }, [cssSize, dpr, boardSize, candidates, first, second, lang, fontsLoaded, variation, stones]);

  useEffect(() => {
    if (hoveredCandidate !== undefined) hovered.current = hoveredCandidate;
  }, [hoveredCandidate]);

  const hover = (move: Move | null) => {
    if (move === hovered.current || sameMove(move, hovered.current)) return;
    hovered.current = move;
    onHoverCandidate?.(move);
  };
  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    hover(candidateAt(x, y, { cssSize, boardSize }, candidates));
  };

  const backing = Math.max(0, Math.round(cssSize * dpr));
  const style = { width: cssSize, height: cssSize, display: 'block' } as const;
  return (
    <div
      className="relative"
      style={{ width: cssSize, height: cssSize }}
      onMouseMove={onMouseMove}
      onMouseLeave={() => hover(null)}
    >
      <canvas ref={board} width={backing} height={backing} style={style} aria-hidden />
      <canvas
        ref={stoneLayer}
        width={backing}
        height={backing}
        className="absolute inset-0"
        style={style}
        aria-hidden
      />
      <canvas
        ref={candidateLayer}
        data-layer="candidates"
        width={backing}
        height={backing}
        className="absolute inset-0"
        style={{
          ...style,
          opacity: catchingUp && !variation ? CATCHING_UP_OPACITY : 1,
          transition: `opacity ${CATCHING_UP_FADE_MS}ms`,
        }}
        aria-hidden
      />
    </div>
  );
}
