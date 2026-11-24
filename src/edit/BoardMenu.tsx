import { trackMutation } from '../game/recordMutations';
import { setupEdit } from './setupEdit';
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
import { useMarkEdit } from './useMarkEdit';
import { useGameStore } from '../game/gameStore';
import { navigate } from '../game/actions';
import { edit } from '../game/editActions';
import { useActionContext } from '../game/useActionContext';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { Point } from '../transport/generated/Point';
import type { BoardNode } from './boardNodes';

import { NodeMenu } from '../tree/NodeMenu';
const POINT_MARKS = ['triangle', 'square', 'circle', 'cross', 'letter', 'number'] as const;

export interface BoardMenuTarget {
  mode: 'normal' | 'setup';
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
  const markEdit = useMarkEdit(ctx);
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
    if (!scoringInProgress() && useGameStore.getState().snapshot?.revision === snapshot.revision)
      void navigate(ctx, { node });
  };
  const start = snapshot.tryout === null ? undefined : nodes.get(snapshot.tryout)?.number;
  const tryHere = async () => {
    if (await boardEdit({ kind: 'tryoutStart' }))
      await boardEdit({ kind: 'play', mv: { type: 'play', ...point } });
  };
  const removeStone = () => setupEdit(ctx, () => ({ kind: 'setupStone', point, stone: null }));
  const flipStone = () =>
    setupEdit(ctx, () => ({
      kind: 'setupStone',
      point,
      stone: stone === 'black' ? 'white' : 'black',
    }));
  const toggleNumbers = () => run('view.moveNumbers');
  const pass = () => void boardEdit({ kind: 'pass' });
  const markAt = (tool: (typeof POINT_MARKS)[number]) =>
    void markEdit({ kind: 'place', tool, point });
  const branchLabel = (b: { letter: string; tryout: boolean }) =>
    t(b.tryout ? 'edit.tryBranch' : 'edit.branch', { letter: b.letter });
  const branchItems = (id: number, tryout: boolean) => {
    const node = nodes.get(id);
    return (
      <NodeMenu
        id={id}
        snapshot={snapshot}
        mainLine={node?.mainLine ?? false}
        firstChild={node?.firstChild ?? false}
        root={node?.root ?? false}
        tryout={tryout}
        start={start}
        available={!!node}
      />
    );
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
        {target.mode === 'setup' ? (
          <>
            <ContextMenuItem onSelect={removeStone}>{t('edit.removeStone')}</ContextMenuItem>
            <ContextMenuItem onSelect={flipStone}>
              {t(stone === 'black' ? 'edit.changeWhite' : 'edit.changeBlack')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <div className="px-2 py-1 text-xs text-text-muted">{t('edit.dragHint')}</div>
          </>
        ) : branches?.length ? (
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
            <ContextMenuItem
              disabled={trying}
              onSelect={() => void trackMutation(ctx.transport, tryHere())}
            >
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
