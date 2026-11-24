import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { moveLabel } from '../board/coordinates';
import { registerCommentEditor, usePendingComment, writeComment } from './commentWrites';
import { useGameStore } from '../game/gameStore';
import { useTreeStore } from '../game/treeStore';
import { useActionContext } from '../game/useActionContext';
import { scoringInProgress, useScoringStore } from '../scoring/scoringStore';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import { useCommentFocus } from './commentFocus';

function CommentField({ snapshot, visit }: { snapshot: GameSnapshot; visit: number }) {
  const ctx = useActionContext();
  const { t } = ctx;
  const tree = useTreeStore((s) => s.tree);
  const node =
    tree?.revision === snapshot.treeRevision
      ? tree.nodes.find((n) => n.id === snapshot.node)
      : undefined;
  // This component is keyed by the node visit. Keep its last confirmed scratch identity
  // until a matching tree arrives, or the trial changes.
  const [verifiedStart, setVerifiedStart] = useState<number | null>(null);
  const scratch =
    tree?.revision === snapshot.treeRevision
      ? node && node.flags & 2
        ? snapshot.tryout
        : null
      : verifiedStart === snapshot.tryout
        ? verifiedStart
        : null;
  if (verifiedStart !== scratch) setVerifiedStart(scratch);
  const trialBlocked = snapshot.tryout !== null && scratch === null;
  const scoring = useScoringStore(scoringInProgress);
  const disabled = trialBlocked || scoring;
  const wanted = useCommentFocus((s) => s.visit);
  const field = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  // An untouched field follows the service. Local typing and an outstanding write take
  // precedence until acknowledged; a late reply must never replace newer typing.
  const draft = useRef<string | null>(null);
  const scratchStart = useRef<number | null>(null);
  const { gameRevision, node: id, comment, moveNumber, lastMove } = snapshot;

  const pending = usePendingComment(ctx.transport, id);
  useLayoutEffect(() => {
    if (field.current && draft.current === null)
      field.current.value = pending?.text ?? comment ?? '';
  }, [pending, comment]);

  const keep = () => {
    const text = draft.current;
    if (text === null) return;
    draft.current = null;
    const current = useGameStore.getState().snapshot;
    const original =
      current?.node === id && current.gameRevision === gameRevision ? current.comment : comment;
    void writeComment(ctx, gameRevision, id, text, original ?? '', scratchStart.current);
  };
  const onLeave = useRef(keep);
  useLayoutEffect(() => {
    onLeave.current = keep;
  });
  useLayoutEffect(() => {
    const unregister = registerCommentEditor(ctx.transport, () => {
      if (field.current && document.activeElement === field.current) field.current.blur();
      else onLeave.current();
    });
    return () => {
      unregister();
      onLeave.current();
    };
  }, [ctx.transport]);
  useEffect(() => {
    if (
      wanted === visit &&
      !disabled &&
      field.current &&
      useGameStore.getState().nodeVisit === visit
    ) {
      field.current.focus();
      if (document.activeElement === field.current && useCommentFocus.getState().visit === visit)
        useCommentFocus.setState({ visit: null });
    }
  }, [disabled, visit, wanted]);

  const color =
    node?.color ??
    (lastMove?.type === 'play' ? snapshot.stones[lastMove.y * snapshot.size + lastMove.x] : null);
  const heading = snapshot.atStart
    ? t('comments.beforeFirst')
    : lastMove && color
      ? t('analysis.graph.move', {
          n: moveNumber,
          color: t(`analysis.graph.${color}`),
          point: moveLabel(lastMove, snapshot.size, t),
        })
      : t('analysis.graph.moveOnly', { n: moveNumber });
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-4 py-3">
      <div className="flex justify-between gap-2 text-xs text-text-muted">
        <span>{heading}</span>
        {!disabled && (
          <span>{focused ? t('comments.finish') : comment ? t('comments.click') : ''}</span>
        )}
      </div>
      <textarea
        ref={field}
        aria-label={t('layout.panels.comments')}
        placeholder={t('comments.add')}
        className="min-h-10 flex-1 resize-none rounded border border-border bg-transparent p-2 text-sm leading-relaxed placeholder:text-text-muted focus-visible:outline-ring"
        disabled={disabled}
        title={trialBlocked ? t('notice.endTryoutFirst') : undefined}
        defaultValue={comment ?? ''}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          scratchStart.current = scratch;
          draft.current = e.target.value;
        }}
        onBlur={() => {
          setFocused(false);
          if (draft.current === null && pending?.status === 'failed') void pending.retry();
          else keep();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export function CommentPanel() {
  const { t } = useTranslation();
  const snapshot = useGameStore((s) => s.snapshot);
  const visit = useGameStore((s) => s.nodeVisit);
  return snapshot ? (
    <CommentField key={visit} snapshot={snapshot} visit={visit} />
  ) : (
    <p className="px-4 py-2 text-sm text-text-muted">{t('comments.add')}</p>
  );
}
