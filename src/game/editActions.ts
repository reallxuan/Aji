import { editGame, redoGame, undoGame, type GameReply } from '../transport/api';
import type { SessionEdit } from '../transport/generated/SessionEdit';
import { toTransportError } from '../transport/transport';
import type { ActionContext } from './actions';
import { useGameStore } from './gameStore';
import { useNoticeStore } from './noticeStore';
import { errorNotice } from './notices';

async function change(
  ctx: Pick<ActionContext, 't' | 'transport'>,
  request: Promise<GameReply>,
): Promise<boolean> {
  try {
    const { snapshot } = await request;
    useGameStore.getState().apply(snapshot);
    // A follow-up (for example playing after tryoutStart) belongs to this snapshot.
    return useGameStore.getState().snapshot?.revision === snapshot.revision;
  } catch (cause) {
    const error = toTransportError(cause);
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
    return false;
  }
}

export const edit = (ctx: Pick<ActionContext, 't' | 'transport'>, e: SessionEdit) =>
  change(ctx, editGame(ctx.transport, e));
export const undo = (ctx: ActionContext) => change(ctx, undoGame(ctx.transport));
export const redo = (ctx: ActionContext) => change(ctx, redoGame(ctx.transport));
