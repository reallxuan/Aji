import { afterReplay } from './replayStore';
import { editGame, redoGame, undoGame, type GameReply } from '../transport/api';
import type { SessionEdit } from '../transport/generated/SessionEdit';
import { toTransportError } from '../transport/transport';
import type { ActionContext } from './actions';
import { useGameStore } from './gameStore';
import { useNoticeStore } from './noticeStore';
import { recordLocked, trackMutation } from './recordMutations';
import { errorNotice } from './notices';
import { useMoveMoveStore } from '../edit/moveMoveStore';

async function applyChange(
  ctx: Pick<ActionContext, 't' | 'transport'>,
  request: Promise<GameReply>,
): Promise<{ visit: number | null } | null> {
  try {
    const { snapshot } = await request;
    useGameStore.getState().apply(snapshot);
    // A follow-up (for example playing after tryoutStart) belongs to this snapshot.
    const state = useGameStore.getState();
    return { visit: state.snapshot?.revision === snapshot.revision ? state.nodeVisit : null };
  } catch (cause) {
    const error = toTransportError(cause);
    if (error.code === 'gameLaterMovesIllegal') {
      // Moving the last move asks first (move-last-move design); the dialog takes it from here.
      useMoveMoveStore.getState().ask(Number(error.detail) || 0);
      return null;
    }
    let label: string | undefined;
    switch (error.code) {
      case 'gameIllegalMove':
        label = ctx.t(`notice.illegalMove.${error.detail}`, {
          defaultValue: ctx.t('errors.gameIllegalMove'),
        });
        break;
      case 'gameEndTryoutFirst':
        label = ctx.t('notice.endTryoutFirst');
        break;
      case 'gameNoSuchNode':
        label = ctx.t('notice.noSuchNode');
        break;
    }
    useNoticeStore
      .getState()
      .show(
        label
          ? { kind: 'warning', title: label }
          : errorNotice(ctx.t('notice.gameFailed'), error, ctx.t),
      );
    return null;
  }
}

function change(ctx: Pick<ActionContext, 'transport' | 't'>, request: () => Promise<GameReply>) {
  return trackMutation(
    ctx.transport,
    afterReplay(ctx.transport, () =>
      recordLocked(ctx.transport) ? Promise.resolve(null) : applyChange(ctx, request()),
    ),
  );
}

/** A refused request returns null. An accepted but superseded snapshot has no current visit. */
export const applyEdit = (ctx: Pick<ActionContext, 't' | 'transport'>, e: SessionEdit) =>
  change(ctx, () => editGame(ctx.transport, e));
export const editAndGetVisit = async (
  ctx: Pick<ActionContext, 't' | 'transport'>,
  e: SessionEdit,
) => (await applyEdit(ctx, e))?.visit ?? null;
export const edit = async (ctx: Pick<ActionContext, 't' | 'transport'>, e: SessionEdit) =>
  (await editAndGetVisit(ctx, e)) !== null;
export const undo = async (ctx: ActionContext) =>
  (await change(ctx, () => undoGame(ctx.transport)))?.visit != null;
export const redo = async (ctx: ActionContext) =>
  (await change(ctx, () => redoGame(ctx.transport)))?.visit != null;
