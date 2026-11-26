import { cn } from 'cn';
import type { Orientation } from './orientation';
import type { MarkAt } from '../transport/generated/MarkAt';
import { drawMarks } from './marks';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { sameMove, type ShownCandidate } from '../analysis/candidates';
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
import { boardGeometry, gridPosition, pointAt, STONE_RADIUS_SHARE } from './geometry';
import { drawStones, makeStoneSprites } from './stones';
import { useBoardGestures } from './useBoardGestures';
import { useDevicePixelRatio } from './useDevicePixelRatio';
import { useGrainMapsVersion } from './grainMaps';
import { BOARD_STYLES, DEFAULT_GRAIN_STRENGTH } from './styles';

export interface BoardCanvasProps {
  /** The board's side in CSS pixels. */
  cssSize: number;
  orientation?: Orientation;
  /** A pending replay step can invalidate the visit between pointer down and release. */
  isGestureCurrent?(): boolean;
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
  onDragStone?(from: Point, to: Point): void;
  onClickPoint?(point: Point): void;
  onClickCandidate?(move: Move): void;
  onContextPoint?(point: Point, at: Point): void;
  onClickBadge?(badge: Badge, at: Point): void;
  onContextBadge?(badge: Badge, at: Point): void;
  marks?: readonly MarkAt[];
  badges?: readonly Badge[];
  tryoutNumbers?: readonly StoneNumber[];
  numbers?: readonly StoneNumber[];
  /** The board and stone styles (P2 M1 design 5.7). Default honey with slate. */
  boardStyle?: BoardId;
  stoneStyle?: StoneId;
  /**
   * The colour a click on an empty point would place, for the square under the mouse (polish
   * design 2); `null` when a click places nothing. Mouse only, never on touch.
   */
  hoverColor?: Color | null;
  /** The wood's grain strength, 0 to 1 (polish design 3). Default `DEFAULT_GRAIN_STRENGTH`. */
  grainStrength?: number;
}

const NONE: never[] = [];
const NO_CANDIDATES: readonly ShownCandidate[] = [];
/** The Inter faces the layers draw with: coordinates 400, disc lines 500 to 700. */
const FONT_FACES = ['400 12px Inter', '500 12px Inter', '600 12px Inter', '700 12px Inter'];
const DEFAULT_LINES: [DiscField, DiscField] = ['winrate', 'scoreLead'];
/**
 * The hover square's side as a share of the spacing (polish design 2): larger than the estimate's
 * territory squares (`OWNER_SQUARE`, 0.36), and rimmed, so the two never read alike.
 */
export const HOVER_SQUARE = 0.52;

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
  onHoverCandidate,
  hoveredCandidate,
  variation = null,
  coordinates = true,
  orientation = 0,
  isGestureCurrent,
  boardStyle = 'honey',
  stoneStyle = 'slate',
  onTapCandidate,
  onSwipeStep,
  nextRing = null,
  ownership = null,
  onTapPoint,
  onClickPoint,
  onDragStone,
  onClickCandidate,
  onClickBadge,
  onContextPoint,
  onContextBadge,
  marks = NONE,
  badges = NONE,
  tryoutNumbers = NONE,
  numbers = NONE,
  hoverColor = null,
  grainStrength = DEFAULT_GRAIN_STRENGTH,
}: BoardCanvasProps) {
  const markLayer = useRef<HTMLCanvasElement>(null);
  const editLayer = useRef<HTMLCanvasElement>(null);
  const board = useRef<HTMLCanvasElement>(null);
  const stoneLayer = useRef<HTMLCanvasElement>(null);
  const ownershipLayer = useRef<HTMLCanvasElement>(null);
  const candidateLayer = useRef<HTMLCanvasElement>(null);
  const hovered = useRef<Move | null>(null);
  // The point under the mouse, off every disc and badge, on the grid it was found on; drives the
  // hover square. A new size, rotation or coordinate band leaves it until the mouse moves again.
  const grid = `${cssSize}:${boardSize}:${orientation}:${coordinates}`;
  const [pointer, setPointer] = useState<{ point: Point; grid: string } | null>(null);
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

  const grainLoaded = useGrainMapsVersion();
  useEffect(() => {
    const ctx = board.current?.getContext('2d');
    if (ctx)
      drawBoard(ctx, {
        cssSize,
        dpr,
        boardSize,
        orientation,
        coordinates,
        style: boardStyle,
        grain: grainStrength,
      });
  }, [
    cssSize,
    dpr,
    boardSize,
    orientation,
    coordinates,
    boardStyle,
    grainStrength,
    fontsLoaded,
    grainLoaded,
  ]);

  const spacing = boardGeometry(cssSize, boardSize, coordinates).spacing;
  // Stones rest on wood with a contact shadow; the printed board stays flat (polish design 3).
  const onWood = BOARD_STYLES[boardStyle].grain !== null;
  const flat = BOARD_STYLES[boardStyle].ink.flat;
  // Drawing a stone with its gradients and shadows is slow; each look is drawn once per
  // spacing and ratio, then stamped.
  const sprites = useMemo(
    () => makeStoneSprites(spacing, dpr, domCanvas, stoneStyle, onWood, flat),
    [spacing, dpr, stoneStyle, onWood, flat],
  );

  const marked = useMemo(
    () => new Set(marks.map(({ point }) => point.y * boardSize + point.x)),
    [marks, boardSize],
  );
  const visibleLastMove =
    lastMove?.type === 'play' && marked.has(lastMove.y * boardSize + lastMove.x) ? null : lastMove;

  useEffect(() => {
    const ctx = stoneLayer.current?.getContext('2d');
    if (ctx && cssSize > 0) {
      drawStones(
        ctx,
        { cssSize, dpr, boardSize, orientation, coordinates },
        stones,
        visibleLastMove,
        sprites,
        ownership?.dead,
      );
    }
  }, [
    cssSize,
    dpr,
    boardSize,
    orientation,
    coordinates,
    stones,
    visibleLastMove,
    sprites,
    ownership,
  ]);

  useEffect(() => {
    const ctx = ownershipLayer.current?.getContext('2d');
    if (!ctx) return;
    const view = { cssSize, dpr, boardSize, orientation, coordinates };
    drawOwnership(ctx, view, ownership?.owners ?? []);
  }, [cssSize, dpr, boardSize, orientation, coordinates, ownership]);

  useEffect(() => {
    const ctx = markLayer.current?.getContext('2d');
    if (ctx)
      drawMarks(
        ctx,
        marks,
        { cssSize, dpr, boardSize, orientation, coordinates, style: boardStyle },
        stones,
      );
  }, [cssSize, dpr, boardSize, orientation, coordinates, boardStyle, stones, marks, fontsLoaded]);

  const [first, second] = discLines;
  useEffect(() => {
    const ctx = candidateLayer.current?.getContext('2d');
    if (!ctx) return;
    const view = { cssSize, dpr, boardSize, orientation, coordinates, style: boardStyle };
    if (variation)
      drawVariationNumbers(ctx, view, variation.numbers, variation.newest, stones, marked);
    else {
      drawCandidates(ctx, view, candidates, [first, second], lang);
      if (nextRing) drawNextRing(ctx, view, nextRing);
    }
  }, [
    nextRing,
    cssSize,
    dpr,
    boardSize,
    orientation,
    coordinates,
    boardStyle,
    candidates,
    first,
    second,
    lang,
    fontsLoaded,
    variation,
    marked,
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
        { cssSize, dpr, boardSize, orientation, coordinates, style: boardStyle },
        stones,
        badges,
        tryoutNumbers,
        numbers,
        marked,
      );
  }, [
    showEdits,
    cssSize,
    dpr,
    boardSize,
    orientation,
    coordinates,
    boardStyle,
    stones,
    badges,
    tryoutNumbers,
    numbers,
    marked,
    fontsLoaded,
  ]);
  const view = { cssSize, boardSize, orientation, coordinates };
  const hitBadge = (x: number, y: number) =>
    badges.length && !variation
      ? badgeAt(boardGeometry(cssSize, boardSize, coordinates, orientation), badges, x, y)
      : undefined;
  const choose = (x: number, y: number, touch: boolean) => {
    if (isGestureCurrent?.() === false) return;
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
    if (isGestureCurrent?.() === false) return;
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
  const gestures = useBoardGestures(
    {
      tap: (x, y) => choose(x, y, true),
      longPress: context,
      drag: onDragStone && {
        stones,
        stoneAt: (x, y) => {
          const p = pointAt(x, y, view);
          return p && stones[p.y * boardSize + p.x] ? p : null;
        },
        drop: (from, x, y) => {
          if (isGestureCurrent?.() === false) return;
          const to = pointAt(x, y, view);
          if (to && (to.x !== from.x || to.y !== from.y)) onDragStone(from, to);
        },
      },
      step: (forward) => {
        if (isGestureCurrent?.() !== false) onSwipeStep?.(forward);
      },
    },
    orientation,
  );
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gestures.consumeClick()) return;
    const box = event.currentTarget.getBoundingClientRect();
    choose(event.clientX - box.left, event.clientY - box.top, false);
  };
  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    // A browser follows a tap with mouse events; the hover is the mouse's alone.
    if (gestures.afterTouch()) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const badge = hitBadge(x, y);
    const disc = badge ? null : candidateAt(x, y, view, candidates);
    hover(disc);
    const point = badge || disc ? null : pointAt(x, y, view);
    setPointer((old) =>
      old?.grid === grid && old.point.x === point?.x && old.point.y === point.y
        ? old
        : point && { point, grid },
    );
  };
  const geometry = boardGeometry(cssSize, boardSize, coordinates, orientation);
  const under =
    pointer?.grid === grid && pointer.point.x < boardSize && pointer.point.y < boardSize
      ? pointer.point
      : null;
  // Not while a stone is dragged: the drop moves that stone, whatever the tool's colour.
  const square =
    hoverColor &&
    under &&
    !variation &&
    !gestures.ghost &&
    !stones[under.y * boardSize + under.x] &&
    !candidates.some(({ move }) => move.type === 'play' && move.x === under.x && move.y === under.y)
      ? { at: gridPosition(geometry, under), color: hoverColor }
      : null;

  const backing = Math.max(0, Math.round(cssSize * dpr));
  const style = { width: cssSize, height: cssSize, display: 'block' } as const;
  return (
    <div
      className="relative"
      // Sideways swipes are the board's; the page may still scroll up and down.
      style={{ width: cssSize, height: cssSize, touchAction: onDragStone ? 'none' : 'pan-y' }}
      onMouseMove={onMouseMove}
      // A finger has no hover: a touch clears the mouse's square.
      onPointerDownCapture={(event) => event.pointerType !== 'mouse' && setPointer(null)}
      onMouseLeave={() => {
        setPointer(null);
        if (!gestures.afterTouch()) hover(null);
      }}
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
      <canvas
        ref={board}
        width={backing}
        height={backing}
        // A wood board sits above the window (polish design 3); printed stays flat on it.
        style={
          BOARD_STYLES[boardStyle].grain ? { ...style, boxShadow: 'var(--board-shadow)' } : style
        }
        aria-hidden
      />
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
      {marks.length > 0 && (
        <canvas
          ref={markLayer}
          data-layer="marks"
          width={backing}
          height={backing}
          className="absolute inset-0 pointer-events-none"
          style={style}
          aria-hidden
        />
      )}
      <canvas
        ref={candidateLayer}
        data-layer="candidates"
        width={backing}
        height={backing}
        className="absolute inset-0"
        style={style}
        aria-hidden
      />
      {gestures.ghost && onDragStone && (
        <span
          aria-hidden
          data-layer="drag-ghost"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed opacity-75"
          style={{
            left: gestures.ghost.x,
            top: gestures.ghost.y,
            width: spacing * 2 * STONE_RADIUS_SHARE,
            height: spacing * 2 * STONE_RADIUS_SHARE,
            backgroundColor:
              stones[gestures.ghost.from.y * boardSize + gestures.ghost.from.x] ?? undefined,
            borderColor:
              stones[gestures.ghost.from.y * boardSize + gestures.ghost.from.x] === 'black'
                ? 'white'
                : 'black',
          }}
        />
      )}
      {square && (
        <span
          aria-hidden
          data-layer="hover-square"
          data-color={square.color}
          className={cn(
            'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 shadow-[0_1px_2px_rgba(0,0,0,0.25)]',
            square.color === 'black'
              ? 'border-white/85 bg-[#151515]'
              : 'border-[#19140c]/85 bg-[#f8f6ef]',
          )}
          style={{
            left: square.at.x,
            top: square.at.y,
            width: geometry.spacing * HOVER_SQUARE,
            height: geometry.spacing * HOVER_SQUARE,
            borderWidth: Math.max(1.2, geometry.spacing * 0.045),
          }}
        />
      )}
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
