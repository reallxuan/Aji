import { useEffect, type RefObject } from 'react';
import { useFrameNavigate } from '../game/useFrameNavigate';

/** Pixels of trackpad scrolling per move. */
const PIXELS_PER_MOVE = 50;

/**
 * The wheel over the board steps through the game (design 5.7): down is next, up is previous.
 * Pixel deltas add up to one move per 50 px; a line or page delta is one move per notch. What is
 * left of a burst is dropped once it moves, and the navigator sends at most one move per frame,
 * so momentum scrolling never runs away.
 */
export function useWheelNavigation(ref: RefObject<HTMLElement | null>): void {
  const go = useFrameNavigate();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let total = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      // A reversal starts over, so turning the wheel back answers at once.
      if (Math.sign(event.deltaY) !== Math.sign(total)) total = 0;
      total +=
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
          ? event.deltaY
          : Math.sign(event.deltaY) * PIXELS_PER_MOVE;
      if (Math.abs(total) < PIXELS_PER_MOVE) return;
      go(total > 0 ? 'next' : 'previous');
      total = 0;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref, go]);
}
