import { useEffect, useRef } from 'react';
import { useGameStore } from '../game/gameStore';
import { previewGame } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { sameMove } from './candidates';
import { useShownCandidates } from './useShownCandidates';
import { linePrefix } from './variation';
import { useViewStore } from './viewStore';

/**
 * Follows the hover (design 5.8): when it starts, the hovered candidate's line is frozen and
 * previewed, so later updates do not change it until the pointer leaves and comes back. A reply
 * that arrives after the hover moved on, or after the game moved, is dropped. A hover whose
 * candidate is no longer shown ends.
 */
export function useVariation(): void {
  const transport = useTransport();
  const { shown } = useShownCandidates();
  const latest = useRef(shown);
  useEffect(() => {
    latest.current = shown;
  });
  const hover = useViewStore((s) => s.hover);
  const hidden = useViewStore((s) => s.hidden || s.held);

  // A hover outlives nothing it points at: once its candidate is gone (a deeper search dropped
  // it, or F or Z hid them all) the row or disc that would end it with a pointer-leave is gone
  // too, and a hover left behind would keep the line up and swallow the board's wheel.
  useEffect(() => {
    if (hover && (hidden || !shown.some((c) => sameMove(c.move, hover.move)))) {
      useViewStore.getState().setHover(null);
    }
  }, [hover, hidden, shown]);

  useEffect(() => {
    useViewStore.getState().setVariation(null);
    const snapshot = useGameStore.getState().snapshot;
    const candidate = hover && latest.current.find((c) => sameMove(c.move, hover.move));
    if (!hover || !candidate || !snapshot) return;
    const moves = linePrefix(candidate.pv);
    if (moves.length === 0) return;
    const other = snapshot.nextColor === 'black' ? 'white' : 'black';
    let active = true;
    previewGame(transport, moves).then(
      (preview) => {
        if (!active) return;
        if (useViewStore.getState().hover !== hover) return;
        if (useGameStore.getState().snapshot?.revision !== snapshot.revision) return;
        useViewStore.getState().setVariation({
          moves,
          colors: moves.map((_, i) => (i % 2 ? other : snapshot.nextColor)),
          captured: preview.captured,
          illegalAt: preview.illegalAt,
        });
      },
      () => {
        // No line: the discs stay.
      },
    );
    return () => {
      active = false;
    };
  }, [hover, transport]);
}
