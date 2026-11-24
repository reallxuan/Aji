import { fromView, toView, type Orientation } from '../board/orientation';
import { useCallback, useLayoutEffect, useRef, type PointerEvent } from 'react';
import { boardGeometry } from '../board/geometry';
import { useDevicePixelRatio } from '../board/useDevicePixelRatio';
import { useFreehandStore, type Point2 } from './freehandStore';

export function FreehandOverlay({
  active,
  cssSize,
  boardSize,
  coordinates,
  orientation = 0,
}: {
  active: boolean;
  cssSize: number;
  boardSize: number;
  coordinates: boolean;
  orientation?: Orientation;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const draft = useRef<{ pointer: number; points: Point2[] } | null>(null);
  const strokes = useFreehandStore((s) => s.strokes);
  const dpr = useDevicePixelRatio();
  const { margin, spacing } = boardGeometry(cssSize, boardSize, coordinates);
  const backing = Math.round(cssSize * dpr);
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, points: Point2[]) => {
      if (!points.length) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 3;
      ctx.strokeStyle = ctx.fillStyle = 'rgba(37,99,235,.85)';
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      const first = toView(points[0], boardSize, orientation);
      const x = margin + first.x * spacing,
        y = margin + first.y * spacing;
      if (points.length === 1) {
        ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.moveTo(x, y);
        for (const p of points.slice(1)) {
          const at = toView(p, boardSize, orientation);
          ctx.lineTo(margin + at.x * spacing, margin + at.y * spacing);
        }
        ctx.stroke();
      }
    },
    [dpr, margin, spacing, orientation, boardSize],
  );
  const redraw = useCallback(() => {
    draft.current = null;
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backing, backing);
    for (const stroke of strokes) paint(ctx, stroke);
  }, [strokes, backing, paint]);
  useLayoutEffect(redraw, [redraw, active]);
  const cancel = (event: PointerEvent<HTMLCanvasElement>) => {
    if (draft.current?.pointer === event.pointerId) redraw();
  };
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return fromView(
      {
        x: (event.clientX - box.left - margin) / spacing,
        y: (event.clientY - box.top - margin) / spacing,
      },
      boardSize,
      orientation,
    );
  };
  if (!active && !strokes.length) return null;
  return (
    <canvas
      ref={canvas}
      data-layer="freehand"
      aria-hidden
      width={backing}
      height={backing}
      className="absolute inset-0"
      style={{
        width: cssSize,
        height: cssSize,
        pointerEvents: active ? 'auto' : 'none',
        touchAction: 'none',
        cursor: 'crosshair',
      }}
      onPointerDown={(event) => {
        if (!active || event.button !== 0 || draft.current || !spacing) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        draft.current = { pointer: event.pointerId, points: [point(event)] };
      }}
      onPointerMove={(event) => {
        const stroke = draft.current;
        if (!stroke || event.pointerId !== stroke.pointer) return;
        const next = point(event);
        const ctx = canvas.current?.getContext('2d');
        if (ctx) paint(ctx, [stroke.points[stroke.points.length - 1], next]);
        stroke.points.push(next);
      }}
      onPointerUp={(event) => {
        const stroke = draft.current;
        if (!stroke || event.pointerId !== stroke.pointer) return;
        const next = point(event),
          last = stroke.points[stroke.points.length - 1];
        if (last.x !== next.x || last.y !== next.y) stroke.points.push(next);
        draft.current = null;
        useFreehandStore.getState().add(stroke.points);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    />
  );
}
