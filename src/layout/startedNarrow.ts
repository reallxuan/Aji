import { currentHasVariations } from '../game/treeStore';
import { MIN_SIZES } from './constants';
import { layoutFrame } from './frameGeometry';
import { validateLayout } from './validate';

let first: boolean | null = null;

/**
 * Whether this session started in the phone layout (P2 M1 design 5.5), decided once from the
 * window and stored layout at the first call. A desktop window narrowed later keeps its answer.
 */
export function startedNarrow(storedLayout: unknown): boolean {
  first ??= layoutFrame(
    validateLayout(storedLayout),
    window.innerWidth,
    window.innerHeight,
    // The registry's sizes, read from the constants so this imports no panel component.
    (ref) => MIN_SIZES[ref.kind],
    currentHasVariations(),
  ).narrow;
  return first;
}

/** Forgets the answer (tests start a new session). */
export function resetStartedNarrow() {
  first = null;
}
