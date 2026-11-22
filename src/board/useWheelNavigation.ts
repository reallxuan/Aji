import { useEffect, type RefObject } from 'react';
import { shownLength } from '../analysis/variation';
import { useViewStore } from '../analysis/viewStore';
import { useFrameNavigate } from '../game/useFrameNavigate';
import type { NavTarget } from '../transport/generated/NavTarget';

/** Pixels of trackpad scrolling per move. */
export const PIXELS_PER_MOVE = 50;

/**
 * Adds up wheel events into steps: `1` forward, `-1` back, `0` while short of one. Pixel deltas
 * make a step per 50 px, a line or page delta one per notch; a reversal starts over, so turning
 * the wheel back answers at once.
 */
export function wheelSteps(): (event: WheelEvent) => -1 | 0 | 1 {
  let total = 0;
  return (event) => {
    if (event.deltaY === 0) return 0;
    if (Math.sign(event.deltaY) !== Math.sign(total)) total = 0;
    total +=
      event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
        ? event.deltaY
        : Math.sign(event.deltaY) * PIXELS_PER_MOVE;
    if (Math.abs(total) < PIXELS_PER_MOVE) return 0;
    const step = total > 0 ? 1 : -1;
    total = 0;
    return step;
  };
}

/**
 * The wheel over the candidate table, while a row is hovered, steps that row's line instead of
 * scrolling the table (M7 minor 7). Away from a row the table scrolls as before.
 */
export function useRowLineWheel(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const steps = wheelSteps();
    const onWheel = (event: WheelEvent) => {
      const view = useViewStore.getState();
      if (event.ctrlKey || view.hover?.source !== 'table' || !view.variation) return;
      event.preventDefault();
      const step = steps(event);
      if (step !== 0) stepLineOrGame(step > 0, () => {});
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });
}

/**
 * One step of the wheel or a swipe over the main board: through the shown line while a candidate
 * is hovered or tapped (from one move to the whole line, never moving the game), else through
 * the game.
 */
export function stepLineOrGame(forward: boolean, go: (to: NavTarget) => void): void {
  const view = useViewStore.getState();
  if (view.hover) {
    if (view.variation && view.step !== null) {
      const step = view.step + (forward ? 1 : -1);
      view.setStep(Math.min(shownLength(view.variation), Math.max(1, step)));
    }
    return;
  }
  go(forward ? 'next' : 'previous');
}

/**
 * The wheel over the board steps through the game (design 5.7): down is next, up is previous.
 * While a candidate is hovered it steps through the candidate's line instead (M7 design 5.8),
 * from one move to the whole line, and never moves the game. With ctrl held the wheel is a pinch,
 * left to the system.
 * Pixel deltas add up to one move per 50 px; a line or page delta is one move per notch. What is
 * left of a burst is dropped once it moves, and the navigator sends at most one move per frame,
 * so momentum scrolling never runs away.
 */
export function useWheelNavigation(ref: RefObject<HTMLElement | null>): void {
  const go = useFrameNavigate();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const steps = wheelSteps();
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const step = steps(event);
      if (step !== 0) stepLineOrGame(step > 0, go);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref, go]);
}
