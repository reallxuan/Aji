import { layoutFrame } from './frameGeometry';
import { panelMinSize } from './registry';
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
    panelMinSize,
  ).narrow;
  return first;
}

/** Forgets the answer (tests start a new session). */
export function resetStartedNarrow() {
  first = null;
}
