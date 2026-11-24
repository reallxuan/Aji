import type { Orientation } from './orientation';
import type { Color } from '../transport/generated/Color';
import type { Point } from '../transport/generated/Point';
import { type PointerEvent, useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Pixels of horizontal swipe per step (P2 M1 design 5.6). */
export const SWIPE_STEP = 40;
/** How far a finger may wander and still tap. */
const SLOP = 10;
/** A press this long is a long press, which opens the board menu. */
const LONG_PRESS_MS = 500;
/** The compatibility mouse events a browser sends after a touch arrive within this. */
const AFTER_TOUCH_MS = 1000;

export interface Gestures {
  drag?: {
    stones: readonly (Color | null)[];
    stoneAt(x: number, y: number): Point | null;
    drop(from: Point, x: number, y: number): void;
  };
  /** A tap at (x, y), in CSS pixels from the board's top left. */
  tap(x: number, y: number): void;
  longPress?(x: number, y: number): void;
  /** One swipe step: forward for a finger moving left, as the wheel moves down. */
  step(forward: boolean): void;
}

type Track = {
  id: number;
  x: number;
  y: number;
  at: number;
  mode: 'pending' | 'drag' | 'swipe' | 'ignore';
  touch: boolean;
  setup: boolean;
  stone: Point | null;
  /** Steps sent so far in this swipe, forward positive. */
  sent: number;
};

/**
 * Touch gestures and setup stone drags. Mouse clicks and hover use the browser events. A touch
 * that stays within 10 px and lifts before 500 ms is a tap. One that moves sideways first is a swipe, one step per 40 px, following the
 * finger back as well as forward. A vertical drag or a second finger cancels the gesture.
 * Holding still for 500 ms opens the context menu. In setup, drags move stones and never step.
 */
export function useBoardGestures(gestures: Gestures, orientation: Orientation = 0) {
  const latest = useRef(gestures);
  useLayoutEffect(() => {
    latest.current = gestures;
  });
  const track = useRef<Track | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [ghost, setGhost] = useState<{ from: Point; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const lastTouch = useRef(Number.NEGATIVE_INFINITY);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    const touch = event.pointerType === 'touch';
    const { drag } = latest.current;
    if (!touch && event.button !== 0) return;
    suppressClick.current = false;
    if (!touch && !drag) return;
    if (touch) lastTouch.current = performance.now();
    if (track.current) {
      // A second finger: this is no gesture of ours (a pinch, a palm).
      clearTimeout(timer.current);
      track.current.mode = 'ignore';
      setGhost(null);
      return;
    }
    const element = event.currentTarget;
    const box = element.getBoundingClientRect();
    if (drag) element.setPointerCapture?.(event.pointerId);
    track.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
      mode: 'pending',
      sent: 0,
      touch,
      setup: !!drag,
      stone: drag?.stoneAt(event.clientX - box.left, event.clientY - box.top) ?? null,
    };
    if (!touch) return;
    timer.current = setTimeout(() => {
      const t = track.current;
      if (!t || t.mode !== 'pending') return;
      t.mode = 'ignore';
      lastTouch.current = performance.now();
      const box = element.getBoundingClientRect();
      latest.current.longPress?.(t.x - box.left, t.y - box.top);
    }, LONG_PRESS_MS);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const t = track.current;
    if (!t || event.pointerId !== t.id || t.mode === 'ignore') return;
    if (t.touch) lastTouch.current = performance.now();
    const dx = event.clientX - t.x;
    const dy = event.clientY - t.y;
    if (t.mode === 'pending') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= SLOP) return;
      clearTimeout(timer.current);
      if (t.setup) {
        suppressClick.current = true;
        t.mode = t.stone && latest.current.drag ? 'drag' : 'ignore';
      } else t.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'ignore';
      if (t.mode === 'ignore') return;
    }
    if (t.mode === 'drag' && t.stone) {
      const box = event.currentTarget.getBoundingClientRect();
      setGhost({ from: t.stone, x: event.clientX - box.left, y: event.clientY - box.top });
      return;
    }
    const target = Math.trunc(-dx / SWIPE_STEP);
    while (t.sent < target) {
      t.sent++;
      latest.current.step(true);
    }
    while (t.sent > target) {
      t.sent--;
      latest.current.step(false);
    }
  }, []);

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const t = track.current;
    if (!t || event.pointerId !== t.id) return;
    if (t.touch) lastTouch.current = performance.now();
    clearTimeout(timer.current);
    track.current = null;
    const box = event.currentTarget.getBoundingClientRect();
    if (t.mode === 'drag' && t.stone) {
      setGhost(null);
      latest.current.drag?.drop(t.stone, event.clientX - box.left, event.clientY - box.top);
      return;
    }
    if (!t.touch || t.mode !== 'pending' || performance.now() - t.at >= LONG_PRESS_MS) return;
    latest.current.tap(t.x - box.left, t.y - box.top);
  }, []);

  const onPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => {
    if (track.current?.id === event.pointerId) {
      clearTimeout(timer.current);
      track.current = null;
      setGhost(null);
    }
  }, []);

  /** Whether a mouse event is the browser's echo of a touch, to be ignored. */
  const afterTouch = useCallback(() => performance.now() - lastTouch.current < AFTER_TOUCH_MS, []);

  // An unfinished drag belongs to the board its stone came from.
  const dragStones = gestures.drag?.stones;
  useLayoutEffect(() => {
    return () => {
      if (track.current) {
        clearTimeout(timer.current);
        suppressClick.current = true;
        track.current = null;
        setGhost(null);
      }
    };
  }, [dragStones, orientation]);

  return {
    ghost,
    consumeClick: () => {
      const suppressed = suppressClick.current;
      suppressClick.current = false;
      return suppressed || afterTouch();
    },
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
    },
    afterTouch,
  };
}
