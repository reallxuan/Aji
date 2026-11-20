import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from '../transport/generated/Color';
import type { Move } from '../transport/generated/Move';
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
}

/**
 * The board surface, `cssSize` CSS pixels square: the wood and grid on one canvas, the stones on
 * a second above it, redrawn on every change of position. Backing stores follow the device pixel
 * ratio, so lines and stones stay sharp on any display.
 */
export function BoardCanvas({ cssSize, boardSize, stones, lastMove }: BoardCanvasProps) {
  const board = useRef<HTMLCanvasElement>(null);
  const stoneLayer = useRef<HTMLCanvasElement>(null);
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

  const backing = Math.max(0, Math.round(cssSize * dpr));
  const style = { width: cssSize, height: cssSize, display: 'block' } as const;
  return (
    <div className="relative" style={{ width: cssSize, height: cssSize }}>
      <canvas ref={board} width={backing} height={backing} style={style} aria-hidden />
      <canvas
        ref={stoneLayer}
        width={backing}
        height={backing}
        className="absolute inset-0"
        style={style}
        aria-hidden
      />
    </div>
  );
}
