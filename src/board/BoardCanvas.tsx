import { useEffect, useRef, useState } from 'react';
import { drawBoard } from './drawBoard';
import { useDevicePixelRatio } from './useDevicePixelRatio';

/**
 * The board surface: an empty board of `boardSize` lines, `cssSize` CSS pixels square. The
 * backing store follows the device pixel ratio, so lines stay sharp on any display.
 */
export function BoardCanvas({ cssSize, boardSize }: { cssSize: number; boardSize: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
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
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawBoard(ctx, { cssSize, dpr, boardSize });
  }, [cssSize, dpr, boardSize, fontsLoaded]);

  const backing = Math.max(0, Math.round(cssSize * dpr));
  return (
    <canvas
      ref={canvas}
      width={backing}
      height={backing}
      style={{ width: cssSize, height: cssSize, display: 'block' }}
      aria-hidden
    />
  );
}
