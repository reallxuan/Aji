import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { sameMove, type ShownCandidate } from '../analysis/candidates';
import { CATCHING_UP_FADE_MS, CATCHING_UP_OPACITY } from '../analysis/constants';
import type { BoardId, StoneId } from '../device/deviceSettings';
import type { Color } from '../transport/generated/Color';
import type { DiscField } from '../transport/generated/DiscField';
import type { Move } from '../transport/generated/Move';
import type { Point } from '../transport/generated/Point';
import { candidateAt, drawCandidates, drawNextRing, drawVariationNumbers } from './candidates';
import { drawOwnership, type Settled } from './ownership';
import { domCanvas } from './canvasFactory';
import { badgeAt, drawEditOverlay, type Badge, type StoneNumber } from './badges';
import { drawBoard } from './drawBoard';
import { boardGeometry, pointAt } from './geometry';
import { drawStones, makeStoneSprites } from './stones';
import { useBoardGestures } from './useBoardGestures';
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
  /** Coordinates in the margin (settings `showCoordinates`); hidden, the grid grows. */
  coordinates?: boolean;
  /** A finger tapped a disc (its move) or anywhere else (`null`) (P2 M1 design 5.6). */
  onTapCandidate?(move: Move | null): void;
  /** A finger swiped one step across the board: forward when moving left. */
  onSwipeStep?(forward: boolean): void;
  /** The record's next move, ringed alone where it has no disc (P2 M2 design 5.6). */
  nextRing?: Point | null;
  /** The position estimate's settled points and dead stones (P2 M2 design 5.7); none when off. */
  ownership?: Settled | null;
  /**
   * A click or tap on an intersection, while the board asks for points (final scoring, P2 M2
   * design 5.8); a tap then goes here and never to a candidate.
   */
  onTapPoint?(point: Point): void;
  onClickPoint?(point: Point): void;
  onClickCandidate?(move: Move): void;
  onContextPoint?(point: Point, at: Point): void;
  onClickBadge?(badge: Badge, at: Point): void;
  onContextBadge?(badge: Badge, at: Point): void;
  badges?: readonly Badge[];
  tryoutNumbers?: readonly StoneNumber[];
  numbers?: readonly StoneNumber[];
  /** The board and stone styles (P2 M1 design 5.7). Default honey with slate. */
  boardStyle?: BoardId;
  stoneStyle?: StoneId;
}

const NONE: never[] = [];
const NO_CANDIDATES: readonly ShownCandidate[] = [];
/** The Inter faces the layers draw with: coordinates 400, disc lines 500 to 700. */
const FONT_FACES = ['400 12px Inter', '500 12px Inter', '600 12px Inter', '700 12px Inter'];
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
  coordinates = true,
  boardStyle = 'honey',
  stoneStyle = 'slate',
  onTapCandidate,
  onSwipeStep,
  nextRing = null,
  ownership = null,
  onTapPoint,
  onClickPoint,
  onClickCandidate,
  onClickBadge,
  onContextPoint,
  onContextBadge,
  badges = NONE,
  tryoutNumbers = NONE,
  numbers = NONE,
}: BoardCanvasProps) {
  const editLayer = useRef<HTMLCanvasElement>(null);
  const board = useRef<HTMLCanvasElement>(null);
  const stoneLayer = useRef<HTMLCanvasElement>(null);
  const ownershipLayer = useRef<HTMLCanvasElement>(null);
  const candidateLayer = useRef<HTMLCanvasElement>(null);
  const hovered = useRef<Move | null>(null);
  const dpr = useDevicePixelRatio();
  // Coordinates, discs and line numbers are drawn in Inter; redraw once every face they use has
  // loaded (M7 minor 10).
  const [fontsLoaded, setFontsLoaded] = useState(0);

  useEffect(() => {
    let active = true;
    const fonts = document.fonts;
    if (!fonts) return;
    Promise.all(FONT_FACES.map((face) => fonts.load(face))).then(
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
    if (ctx) drawBoard(ctx, { cssSize, dpr, boardSize, coordinates, style: boardStyle });
  }, [cssSize, dpr, boardSize, coordinates, boardStyle, fontsLoaded]);

  const spacing = boardGeometry(cssSize, boardSize, coordinates).spacing;
  // Drawing a stone with its gradients and shadows is slow; each look is drawn once per
  // spacing and ratio, then stamped.
  const sprites = useMemo(
    () => makeStoneSprites(spacing, dpr, domCanvas, stoneStyle),
    [spacing, dpr, stoneStyle],
  );

  useEffect(() => {
    const ctx = stoneLayer.current?.getContext('2d');
    if (ctx && cssSize > 0) {
      drawStones(
        ctx,
        { cssSize, dpr, boardSize, coordinates },
        stones,
        lastMove,
        sprites,
        ownership?.dead,
      );
    }
  }, [cssSize, dpr, boardSize, coordinates, stones, lastMove, sprites, ownership]);

  useEffect(() => {
    const ctx = ownershipLayer.current?.getContext('2d');
    if (!ctx) return;
    const view = { cssSize, dpr, boardSize, coordinates };
    drawOwnership(ctx, view, ownership?.owners ?? []);
  }, [cssSize, dpr, boardSize, coordinates, ownership]);

  const [first, second] = discLines;
  useEffect(() => {
    const ctx = candidateLayer.current?.getContext('2d');
    if (!ctx) return;
    const view = { cssSize, dpr, boardSize, coordinates, style: boardStyle };
    if (variation) drawVariationNumbers(ctx, view, variation.numbers, variation.newest, stones);
    else {
      drawCandidates(ctx, view, candidates, [first, second], lang);
      if (nextRing) drawNextRing(ctx, view, nextRing);
    }
  }, [
    nextRing,
    cssSize,
    dpr,
    boardSize,
    coordinates,
    boardStyle,
    candidates,
    first,
    second,
    lang,
    fontsLoaded,
    variation,
    stones,
  ]);

  useEffect(() => {
    if (hoveredCandidate !== undefined) hovered.current = hoveredCandidate;
  }, [hoveredCandidate]);

  const hover = (move: Move | null) => {
    if (move === hovered.current || sameMove(move, hovered.current)) return;
    hovered.current = move;
    onHoverCandidate?.(move);
  };
  const showEdits = !variation && !!(badges.length || tryoutNumbers.length || numbers.length);
  useEffect(() => {
    const ctx = editLayer.current?.getContext('2d');
    if (ctx)
      drawEditOverlay(
        ctx,
        { cssSize, dpr, boardSize, coordinates, style: boardStyle },
        stones,
        badges,
        tryoutNumbers,
        numbers,
      );
  }, [
    showEdits,
    cssSize,
    dpr,
    boardSize,
    coordinates,
    boardStyle,
    stones,
    badges,
    tryoutNumbers,
    numbers,
    fontsLoaded,
  ]);
  const view = { cssSize, boardSize, coordinates };
  const hitBadge = (x: number, y: number) =>
    badges.length && !variation
      ? badgeAt(boardGeometry(cssSize, boardSize, coordinates), badges, x, y)
      : undefined;
  const choose = (x: number, y: number, touch: boolean) => {
    const point = pointAt(x, y, view);
    if (onTapPoint) {
      if (point) onTapPoint(point);
      return;
    }
    const badge = hitBadge(x, y);
    if (badge && onClickBadge) {
      const box = board.current!.getBoundingClientRect();
      onClickBadge(badge, { x: x + box.left, y: y + box.top });
      return;
    }
    const disc = candidateAt(x, y, view, candidates);
    if (touch) onTapCandidate?.(disc);
    else if (disc) onClickCandidate?.(disc);
    if (!disc && point) onClickPoint?.(point);
  };
  const context = (x: number, y: number) => {
    const box = board.current?.getBoundingClientRect();
    if (!box) return;
    const at = { x: x + box.left, y: y + box.top };
    const badge = hitBadge(x, y);
    if (badge && onContextBadge) {
      onContextBadge(badge, at);
      return;
    }
    const point = pointAt(x, y, view);
    if (point) onContextPoint?.(point, at);
  };
  const gestures = useBoardGestures({
    tap: (x, y) => choose(x, y, true),
    longPress: context,
    step: (forward) => onSwipeStep?.(forward),
  });
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gestures.afterTouch()) return;
    const box = event.currentTarget.getBoundingClientRect();
    choose(event.clientX - box.left, event.clientY - box.top, false);
  };
  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    // A browser follows a tap with mouse events; the hover is the mouse's alone.
    if (gestures.afterTouch()) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    hover(hitBadge(x, y) ? null : candidateAt(x, y, view, candidates));
  };

  const backing = Math.max(0, Math.round(cssSize * dpr));
  const style = { width: cssSize, height: cssSize, display: 'block' } as const;
  return (
    <div
      className="relative"
      // Sideways swipes are the board's; the page may still scroll up and down.
      style={{ width: cssSize, height: cssSize, touchAction: 'pan-y' }}
      onMouseMove={onMouseMove}
      onMouseLeave={() => !gestures.afterTouch() && hover(null)}
      onClick={onClick}
      onContextMenu={(event) => {
        if (!onContextPoint && !onContextBadge) return;
        event.preventDefault();
        if (gestures.afterTouch()) return;
        const box = event.currentTarget.getBoundingClientRect();
        context(event.clientX - box.left, event.clientY - box.top);
      }}
      {...gestures.handlers}
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
        ref={ownershipLayer}
        data-layer="ownership"
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
      {showEdits && (
        <canvas
          ref={editLayer}
          data-layer="editing"
          width={backing}
          height={backing}
          className="absolute inset-0 pointer-events-none"
          style={style}
          aria-hidden
        />
      )}
    </div>
  );
}
