import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { HAIRLINE_HIT, HAIRLINE_HIT_COARSE } from './constants';

/** Moves the hairline `delta` px from where the drag began; `sizes` are the neighbours' then. */
export type Mover = (delta: number, sizes: [number, number]) => void;

/** A resize under way: its moves, and the undo of all of them. */
export type Resize = { move: Mover; cancel(): void };

const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 4;

/** The two neighbours' sizes along the split: the place before this hairline, and its own. */
function siblingSizes(el: HTMLElement, dir: 'row' | 'column'): [number, number] {
  const place = el.parentElement;
  const before = place?.previousElementSibling;
  if (!place || !before) return [0, 0];
  const size = (e: Element) =>
    dir === 'column' ? e.getBoundingClientRect().height : e.getBoundingClientRect().width;
  return [size(before), size(place)];
}

/**
 * The draggable line between two siblings of a split (design 5.3). It sits on the leading edge
 * of the later sibling, with an 8 px hit area (20 px for a coarse pointer). Dragging moves weight
 * between the two; a double-click or double-tap evens them. A blur, a window resize, Escape or a
 * cancelled pointer ends the drag and puts the layout back as it was. `sizes`, when given, are the two
 * neighbours' sizes; otherwise they are measured from the siblings around the line.
 */
export function Hairline({
  dir,
  coarse,
  begin,
  onEven,
  sizes,
  style,
}: {
  dir: 'row' | 'column';
  coarse: boolean;
  begin(): Resize;
  onEven(): void;
  sizes?: [number, number];
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const dragging = useRef(false);
  const lastTap = useRef(0);
  const hit = coarse ? HAIRLINE_HIT_COARSE : HAIRLINE_HIT;
  const along = (e: { clientX: number; clientY: number }) =>
    dir === 'column' ? e.clientY : e.clientX;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  // The pointer leaves an 8 px line at once, so the drag follows it through the window, as a
  // panel's drag does; capture, where it works, only keeps other elements from reacting.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current || e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The window listeners below follow the pointer without it.
    }
    const pointerId = e.pointerId;
    const start = along(e);
    const measured = sizes ?? siblingSizes(e.currentTarget, dir);
    const resize = begin();
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) resize.move(along(ev) - start, measured);
    };
    const cancel = () => {
      end();
      resize.cancel();
    };
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && cancel();
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      end();
      // A touch screen fires no double-click, so two quick taps even the line there.
      if (ev.pointerType === 'touch' && Math.abs(along(ev) - start) < TAP_SLOP) {
        if (ev.timeStamp - lastTap.current < DOUBLE_TAP_MS) onEven();
        lastTap.current = ev.timeStamp;
      }
    };
    const onCancel = (ev: PointerEvent) => ev.pointerId === pointerId && cancel();
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('keydown', onKey);
      dragging.current = false;
      stop.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    // The sizes measured at the start no longer hold after a resize, and a release can be lost
    // while the window is in the background.
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('keydown', onKey);
    dragging.current = true;
    stop.current = end;
  };

  const placed: CSSProperties =
    dir === 'column'
      ? { left: 0, right: 0, top: -hit / 2, height: hit, cursor: 'row-resize' }
      : { top: 0, bottom: 0, left: -hit / 2, width: hit, cursor: 'col-resize' };
  return (
    <div
      data-hairline
      role="separator"
      aria-label={t('layout.resize')}
      aria-orientation={dir === 'column' ? 'horizontal' : 'vertical'}
      className="absolute z-10 touch-none"
      style={{ ...placed, ...style }}
      onPointerDown={onPointerDown}
      onDoubleClick={onEven}
    />
  );
}
