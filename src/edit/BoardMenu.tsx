import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import { useRunCommand } from '../commands/useKeyDispatcher';
import { scoringInProgress } from '../scoring/scoringStore';
import type { SessionEdit } from '../transport/generated/SessionEdit';
import { useDeviceStore } from '../device/deviceStore';
import { pointLabel } from '../board/coordinates';
import { nextLabel } from '../board/marks';
import { navigate } from '../game/actions';
import { edit } from '../game/editActions';
import { useActionContext } from '../game/useActionContext';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { Mark } from '../transport/generated/Mark';
import type { Point } from '../transport/generated/Point';
import type { BoardNode } from './boardNodes';

const BRANCH_EDITS = ['promote', 'moveUp', 'deleteBranch', 'deleteFrom'] as const;
const POINT_MARKS = ['triangle', 'square', 'circle', 'cross', 'letter', 'number'] as const;

export interface BoardMenuTarget {
  at: Point;
  point: Point;
  revision: number;
  branches?: Array<{ node: number; letter: string; tryout: boolean }>;
  chooseMove?: boolean;
}

export function BoardMenu({
  target,
  snapshot,
  nodes,
  onClose,
}: {
  target: BoardMenuTarget;
  snapshot: GameSnapshot;
  nodes: ReadonlyMap<number, BoardNode>;
  onClose(): void;
}) {
  const ctx = useActionContext();
  const { t } = useTranslation();
  const run = useRunCommand();
  const showing = useDeviceStore((s) => s.settings.moveNumbers.mode !== 'off');
  const trigger = useRef<HTMLSpanElement>(null);
  // Radix anchors its context menu to a pointer event. The board's gesture recognizer has
  // already resolved the hit and the 500 ms timer; both input paths share this single anchor.
  useLayoutEffect(() => {
    trigger.current?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: target.at.x,
        clientY: target.at.y,
        button: 2,
      }),
    );
  }, [target]);
  const { point, branches } = target;
  const stone = snapshot.stones[point.y * snapshot.size + point.x];
  const placed = snapshot.placed.find((p) => p.point.x === point.x && p.point.y === point.y);
  const trying = snapshot.tryout !== null;
  const boardEdit = (e: SessionEdit) => (scoringInProgress() ? false : edit(ctx, e));
  const go = (node: number) => {
    if (!scoringInProgress()) void navigate(ctx, { node });
  };
  const start = snapshot.tryout === null ? undefined : nodes.get(snapshot.tryout)?.number;
  const tryHere = async () => {
    if (await boardEdit({ kind: 'tryoutStart' }))
      await boardEdit({ kind: 'play', mv: { type: 'play', ...point } });
  };
  const endTryout = () => void boardEdit({ kind: 'tryoutEnd' });
  const toggleNumbers = () => run('view.moveNumbers');
  const pass = () => void boardEdit({ kind: 'pass' });
  const markAt = (kind: (typeof POINT_MARKS)[number]) => {
    const mark: Mark =
      kind === 'letter' || kind === 'number'
        ? { kind: 'label', text: nextLabel(snapshot.marks, kind) }
        : { kind };
    void boardEdit({ kind: 'setMark', point, node: snapshot.node, mark });
  };
  const branchLabel = (b: { letter: string; tryout: boolean }) =>
    t(b.tryout ? 'edit.tryBranch' : 'edit.branch', { letter: b.letter });
  const branchItems = (id: number, tryout: boolean) => {
    const node = nodes.get(id);
    if (tryout) {
      const keep = () => void boardEdit({ kind: 'tryoutKeep', node: id });
      return (
        <>
          <ContextMenuItem onSelect={endTryout}>
            {t('edit.end')}
            {start !== undefined && (
              <small className="ml-auto text-text-muted">{t('edit.backTo', { n: start })}</small>
            )}
          </ContextMenuItem>
          <ContextMenuItem onSelect={keep}>{t('edit.keep')}</ContextMenuItem>
        </>
      );
    }
    return BRANCH_EDITS.map((kind) => (
      <ContextMenuItem
        key={kind}
        disabled={
          trying ||
          !node ||
          (kind === 'moveUp' && node.firstChild) ||
          ((kind === 'promote' || kind === 'deleteBranch') && node.mainLine)
        }
        title={trying ? t('notice.endTryoutFirst') : undefined}
        onSelect={() => void boardEdit({ kind, node: id })}
      >
        {t(kind === 'deleteFrom' ? 'commands.edit.deleteFrom' : `edit.${kind}`)}
      </ContextMenuItem>
    ));
  };
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ContextMenuTrigger asChild>
        <span ref={trigger} aria-hidden className="pointer-events-none fixed size-0" />
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44 whitespace-nowrap">
        <div className="px-2 py-1 text-xs text-text-muted">
          {t(`edit.${stone ?? 'empty'}`, { point: pointLabel(point, snapshot.size) })}
        </div>
        {branches?.length ? (
          branches.length === 1 ? (
            branchItems(branches[0].node, branches[0].tryout)
          ) : (
            branches.map((branch) =>
              target.chooseMove ? (
                <ContextMenuItem key={branch.node} onSelect={() => go(branch.node)}>
                  {branchLabel(branch)}
                </ContextMenuItem>
              ) : (
                <ContextMenuSub key={branch.node}>
                  <ContextMenuSubTrigger>{branchLabel(branch)}</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {branchItems(branch.node, branch.tryout)}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ),
            )
          )
        ) : placed && trying && nodes.get(placed.node)?.tryout ? (
          branchItems(placed.node, true)
        ) : stone ? (
          <>
            {placed && (
              <ContextMenuItem onSelect={() => go(placed.node)}>
                {t('edit.goToStone', { n: placed.number })}
              </ContextMenuItem>
            )}
            <ContextMenuCheckboxItem checked={showing} onSelect={toggleNumbers}>
              {t('edit.showNumbers')}
            </ContextMenuCheckboxItem>
          </>
        ) : (
          <>
            <ContextMenuItem disabled={trying} onSelect={() => void tryHere()}>
              {t('edit.tryHere')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={pass}>{t('analysis.pass')}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger
                disabled={trying}
                title={trying ? t('notice.endTryoutFirst') : undefined}
              >
                {t('edit.markup')}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {POINT_MARKS.map((kind) => (
                  <ContextMenuItem key={kind} onSelect={() => markAt(kind)}>
                    {t(`edit.${kind}`)}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
