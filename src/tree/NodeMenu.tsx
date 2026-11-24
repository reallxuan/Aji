import { useTranslation } from 'react-i18next';
import { ContextMenuItem, ContextMenuSeparator } from '../components/ui/context-menu';
import { requestCommentFocus } from '../comments/commentFocus';
import { useDeviceStore } from '../device/deviceStore';
import { navigate } from '../game/actions';
import { edit } from '../game/editActions';
import { useGameStore } from '../game/gameStore';
import { useActionContext } from '../game/useActionContext';
import { currentHasVariations, useTreeStore } from '../game/treeStore';
import { selectTab, showPanel } from '../layout/ops';
import { currentLayout, setLayout } from '../layout/useLayout';
import { frameMinSize } from '../layout/useDrawnLayout';
import { layoutFrame } from '../layout/frameGeometry';
import { scoringInProgress } from '../scoring/scoringStore';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';

export function currentTreeTarget(snapshot: GameSnapshot) {
  return (
    !scoringInProgress() &&
    useGameStore.getState().snapshot?.revision === snapshot.revision &&
    useTreeStore.getState().tree?.revision === snapshot.treeRevision
  );
}

/** The same items serve tree stones, continuation badges and overlapping badge submenus. */
export function NodeMenu({
  id,
  snapshot,
  mainLine,
  firstChild,
  root,
  tryout,
  start,
  available = true,
}: {
  id: number;
  snapshot: GameSnapshot;
  mainLine: boolean;
  firstChild: boolean;
  root: boolean;
  tryout: boolean;
  start?: number;
  available?: boolean;
}) {
  const ctx = useActionContext();
  const { t } = useTranslation();
  const trying = snapshot.tryout !== null;
  const disabled = !available || !currentTreeTarget(snapshot);
  const canAct = () => available && currentTreeTarget(snapshot);
  const comment = async () => {
    if (!canAct() || trying) return;
    const acknowledged = snapshot.node === id ? snapshot : await navigate(ctx, { node: id });
    const { snapshot: current, nodeVisit } = useGameStore.getState();
    if (
      !current ||
      !acknowledged ||
      acknowledged.node !== id ||
      acknowledged.gameRevision !== snapshot.gameRevision ||
      nodeVisit > acknowledged.revision ||
      scoringInProgress() ||
      current.tryout !== null ||
      current.node !== id ||
      current.gameRevision !== snapshot.gameRevision
    )
      return;
    const comments = { kind: 'comments' } as const;
    const layout = currentLayout();
    const frame = layoutFrame(
      layout,
      window.innerWidth,
      window.innerHeight,
      frameMinSize(false),
      currentHasVariations(),
    );
    if (frame.narrow) {
      const shown = showPanel(layout, comments);
      if (shown !== layout) setLayout(shown);
      useDeviceStore.getState().update({ narrowTab: 'comments' });
    } else {
      setLayout(selectTab(showPanel(layout, comments), comments));
    }
    requestCommentFocus(id);
  };
  const end = () => canAct() && void edit(ctx, { kind: 'tryoutEnd' });
  const keep = () => canAct() && void edit(ctx, { kind: 'tryoutKeep', node: id });
  if (tryout)
    return (
      <>
        <ContextMenuItem disabled={disabled || !trying} onSelect={end}>
          {t('edit.end')}
          {start !== undefined && (
            <small className="ml-auto text-text-muted">{t('edit.backTo', { n: start })}</small>
          )}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled || !trying} onSelect={keep}>
          {t('edit.keep')}
        </ContextMenuItem>
      </>
    );
  const item = (kind: 'promote' | 'moveUp' | 'deleteBranch' | 'deleteFrom', blocked: boolean) => (
    <ContextMenuItem
      disabled={disabled || trying || blocked}
      title={trying ? t('notice.endTryoutFirst') : undefined}
      onSelect={() => canAct() && void edit(ctx, { kind, node: id })}
    >
      {t(kind === 'deleteFrom' ? 'commands.edit.deleteFrom' : `edit.${kind}`)}
    </ContextMenuItem>
  );
  const promote = item('promote', mainLine);
  const moveUp = item('moveUp', firstChild);
  const deleteBranch = item('deleteBranch', mainLine);
  const deleteFrom = item('deleteFrom', root);
  return (
    <>
      {promote}
      {moveUp}
      <ContextMenuSeparator />
      {deleteBranch}
      {deleteFrom}
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={disabled || trying}
        title={trying ? t('notice.endTryoutFirst') : undefined}
        onSelect={() => void comment()}
      >
        {t('edit.editComment')}
      </ContextMenuItem>
    </>
  );
}
