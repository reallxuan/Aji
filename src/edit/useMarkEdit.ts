import { recordLocked, trackMutation } from '../game/recordMutations';
import { toggledMark } from '../board/marks';
import type { ActionContext } from '../game/actions';
import { edit } from '../game/editActions';
import { useGameStore } from '../game/gameStore';
import { scoringInProgress } from '../scoring/scoringStore';
import type { Point } from '../transport/generated/Point';
import type { Transport } from '../transport/transport';
import type { MarkupTool } from './modeStore';

type MarkInput =
  | { kind: 'clear' }
  | {
      kind: 'toggle' | 'place';
      tool: Exclude<MarkupTool, 'freehand'>;
      point: Point;
    };

const pending = new WeakMap<Transport, Promise<void>>();

/** Resolve marks in input order: two clicks can arrive before the first edit's snapshot. */
export function useMarkEdit(ctx: ActionContext) {
  const visit = useGameStore((s) => s.nodeVisit);
  return (input: MarkInput) => {
    if (recordLocked(ctx.transport)) return Promise.resolve();
    const apply = async () => {
      const { snapshot, nodeVisit } = useGameStore.getState();
      if (!snapshot || nodeVisit !== visit || snapshot.tryout !== null || scoringInProgress())
        return;
      const { marks, node } = snapshot;
      if (input.kind === 'clear') {
        await edit(ctx, { kind: 'clearMarks', node });
        return;
      }
      const { tool, point } = input;
      const existing =
        input.kind === 'toggle'
          ? marks.find((at) => at.point.x === point.x && at.point.y === point.y)?.mark
          : undefined;
      await edit(ctx, { kind: 'setMark', node, point, mark: toggledMark(marks, existing, tool) });
    };
    const previous = pending.get(ctx.transport);
    const next = trackMutation(ctx.transport, previous ? previous.then(apply) : apply());
    pending.set(ctx.transport, next);
    return next.finally(() => {
      if (pending.get(ctx.transport) === next) pending.delete(ctx.transport);
    });
  };
}
