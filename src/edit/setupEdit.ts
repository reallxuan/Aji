import { recordLocked, trackMutation } from '../game/recordMutations';
import type { ActionContext } from '../game/actions';
import { editAndGetVisit } from '../game/editActions';
import { useGameStore } from '../game/gameStore';
import { scoringInProgress } from '../scoring/scoringStore';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { SessionEdit } from '../transport/generated/SessionEdit';
import type { Transport } from '../transport/transport';
import { useModeStore } from './modeStore';

const pending = new WeakMap<Transport, Promise<number | null>>();

/** A placement can enter a new setup child. Resolve the next input against that reply. */
export function setupEdit(ctx: ActionContext, build: (snapshot: GameSnapshot) => SessionEdit) {
  if (recordLocked(ctx.transport)) return;
  const visit = useGameStore.getState().nodeVisit;
  const apply = async (previousVisit: number | null) => {
    const { snapshot, nodeVisit } = useGameStore.getState();
    if (
      !snapshot ||
      (nodeVisit !== visit && nodeVisit !== previousVisit) ||
      snapshot.tryout !== null ||
      scoringInProgress() ||
      useModeStore.getState().mode !== 'setup'
    )
      return null;
    // A refused edit stays at its starting visit. Navigation during the request
    // invalidates that visit when the next queued input checks the current board.
    return (await editAndGetVisit(ctx, build(snapshot))) ?? nodeVisit;
  };
  const previous = pending.get(ctx.transport);
  const next = trackMutation(ctx.transport, previous ? previous.then(apply) : apply(null));
  pending.set(ctx.transport, next);
  void next.finally(() => {
    if (pending.get(ctx.transport) === next) pending.delete(ctx.transport);
  });
}
