import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { dropTarget, outlineRect, type PanelRect } from './dropTarget';
import type { Rect } from './frameGeometry';
import { type PanelRef, refFromId } from './model';
import type { Drop } from './ops';

export type PanelDrag = {
  ref: PanelRef;
  point: { x: number; y: number };
  drop: Drop;
  /** Where the accent outline is drawn, in window coordinates. */
  outline: Rect | null;
};

const toRect = (el: Element): Rect => {
  const { x, y, width, height } = el.getBoundingClientRect();
  return { x, y, width, height };
};

/** The shown panels and the board as they are on screen now. */
function measure(container: HTMLElement): { rects: PanelRect[]; board: Rect } | null {
  const board = container.querySelector('[data-board]');
  if (!board) return null;
  const rects: PanelRect[] = [];
  for (const el of container.querySelectorAll('[data-panel]')) {
    const ref = refFromId(el.getAttribute('data-panel') ?? '');
    if (ref) rects.push({ ref, rect: toRect(el) });
  }
  return { rects, board: toRect(board) };
}

/**
 * Dragging a panel by its grip (design 5.3). The pointer is captured, so mouse, pen and touch
 * behave the same; a second pointer is ignored. Releasing drops the panel through `onDrop`;
 * `pointercancel`, a window resize, losing focus or Escape cancel and leave the layout as it was.
 */
export function useDragPanel(
  container: RefObject<HTMLElement | null>,
  onDrop: (ref: PanelRef, drop: NonNullable<Drop>) => void,
): { drag: PanelDrag | null; startDrag(ref: PanelRef, e: ReactPointerEvent): void } {
  const [drag, setDrag] = useState<PanelDrag | null>(null);
  const active = useRef<{ stop(): void } | null>(null);
  const dropRef = useRef(onDrop);
  useLayoutEffect(() => {
    dropRef.current = onDrop;
  });
  useEffect(() => () => active.current?.stop(), []);

  const startDrag = useCallback(
    (ref: PanelRef, e: ReactPointerEvent) => {
      if (active.current || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // The pointer may already be gone; the window listeners still see it.
      }
      const pointerId = e.pointerId;
      let drop: Drop = null;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId || !container.current) return;
        const point = { x: ev.clientX, y: ev.clientY };
        const measured = measure(container.current);
        drop = measured ? dropTarget(measured.rects, measured.board, point, ref) : null;
        setDrag({
          ref,
          point,
          drop,
          outline: measured ? outlineRect(drop, measured.rects, measured.board) : null,
        });
      };
      const finish = (commit: boolean) => {
        stop();
        if (commit && drop) dropRef.current(ref, drop);
      };
      const onUp = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
      const onCancel = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);
      const onAbort = () => finish(false);
      const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(false);
      const stop = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('resize', onAbort);
        window.removeEventListener('blur', onAbort);
        window.removeEventListener('keydown', onKey);
        active.current = null;
        setDrag(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('resize', onAbort);
      window.addEventListener('blur', onAbort);
      window.addEventListener('keydown', onKey);
      active.current = { stop };
      setDrag({ ref, point: { x: e.clientX, y: e.clientY }, drop: null, outline: null });
    },
    [container],
  );

  return { drag, startDrag };
}
