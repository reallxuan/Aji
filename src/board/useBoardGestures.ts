import { type PointerEvent, useCallback, useLayoutEffect, useRef } from 'react';

/** Pixels of horizontal swipe per step (P2 M1 design 5.6). */
export const SWIPE_STEP = 40;
/** How far a finger may wander and still tap. */
const SLOP = 10;
/** A press this long is a long press, which opens the board menu. */
const LONG_PRESS_MS = 500;
/** The compatibility mouse events a browser sends after a touch arrive within this. */
const AFTER_TOUCH_MS = 1000;

export interface Gestures {
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
  mode: 'pending' | 'swipe' | 'ignore';
  /** Steps sent so far in this swipe, forward positive. */
  sent: number;
};

/**
 * The board's touch gestures (P2 M1 design 5.6). Only pointers of type `touch` count, so a mouse
 * on a touchscreen laptop keeps its hover. A touch that stays within 10 px and lifts before
 * 500 ms is a tap. One that moves sideways first is a swipe, one step per 40 px, following the
 * finger back as well as forward. A vertical drag or a second finger cancels the gesture.
 * Holding still for 500 ms opens the context menu.
 */
export function useBoardGestures(gestures: Gestures) {
  const latest = useRef(gestures);
  useLayoutEffect(() => {
    latest.current = gestures;
  });
  const track = useRef<Track | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => () => clearTimeout(timer.current), []);
  const lastTouch = useRef(Number.NEGATIVE_INFINITY);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return;
    lastTouch.current = performance.now();
    if (track.current) {
      // A second finger: this is no gesture of ours (a pinch, a palm).
      clearTimeout(timer.current);
      track.current.mode = 'ignore';
      return;
    }
    // A touch pointer is captured by the element it went down on, so no capture call is needed.
    track.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
      mode: 'pending',
      sent: 0,
    };
    const element = event.currentTarget;
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
    lastTouch.current = performance.now();
    const dx = event.clientX - t.x;
    const dy = event.clientY - t.y;
    if (t.mode === 'pending') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= SLOP) return;
      clearTimeout(timer.current);
      t.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'ignore';
      if (t.mode === 'ignore') return;
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
    lastTouch.current = performance.now();
    clearTimeout(timer.current);
    track.current = null;
    if (t.mode !== 'pending' || performance.now() - t.at >= LONG_PRESS_MS) return;
    const box = event.currentTarget.getBoundingClientRect();
    latest.current.tap(t.x - box.left, t.y - box.top);
  }, []);

  const onPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => {
    if (track.current?.id === event.pointerId) {
      clearTimeout(timer.current);
      track.current = null;
    }
  }, []);

  /** Whether a mouse event is the browser's echo of a touch, to be ignored. */
  const afterTouch = useCallback(() => performance.now() - lastTouch.current < AFTER_TOUCH_MS, []);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    afterTouch,
  };
}
