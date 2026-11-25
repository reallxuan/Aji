import { create } from 'zustand';
import type { ActionContext } from '../game/actions';
import { applyEdit } from '../game/editActions';
import type { Color } from '../transport/generated/Color';
import type { Point } from '../transport/generated/Point';

/**
 * Moving the last move (move-last-move design): the board waits for a new point while `picking`
 * holds the moved stone's colour. A refusal because later moves would turn illegal opens
 * `confirm` with their count; confirming sends the same point again, allowing it.
 */
interface MoveMoveState {
  picking: Color | null;
  /** The point on its way to the backend, so a refusal can ask about it. */
  pending: Point | null;
  confirm: { to: Point; count: number } | null;
  start(color: Color): void;
  cancel(): void;
  /** The backend refused `pending` because `count` later moves would become illegal. */
  ask(count: number): void;
}

const initial = { picking: null, pending: null, confirm: null };

export const useMoveMoveStore = create<MoveMoveState>()((set, get) => ({
  ...initial,
  start: (picking) => set({ picking, confirm: null }),
  cancel: () => set(initial),
  ask: (count) => {
    const to = get().pending;
    set({ pending: null, confirm: to ? { to, count } : null });
  },
}));

export function resetMoveMoveStore(): void {
  useMoveMoveStore.setState(initial);
}

/**
 * Sends the last move to `to`; with `allowIllegal`, after the owner confirmed. While it is on its
 * way, `pending` holds the point and the board takes no other click (a double click's second half
 * would otherwise play a move there).
 */
export async function moveLastMove(
  ctx: Pick<ActionContext, 't' | 'transport'>,
  to: Point,
  allowIllegal = false,
): Promise<unknown> {
  useMoveMoveStore.setState({ picking: null, confirm: null, pending: to });
  try {
    return await applyEdit(ctx, { kind: 'moveLastMove', to, allowIllegal });
  } finally {
    // A refusal that asks has already taken the point into `confirm`.
    if (useMoveMoveStore.getState().pending === to) useMoveMoveStore.setState({ pending: null });
  }
}
