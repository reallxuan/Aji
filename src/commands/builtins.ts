import { useEstimateStore } from '../analysis/estimateStore';
import { useViewStore } from '../analysis/viewStore';
import { openFromPicker, saveAs, startNewGame } from '../game/actions';
import { edit, undo, redo } from '../game/editActions';
import { useModeStore } from '../edit/modeStore';
import { useGameStore } from '../game/gameStore';
import { clearAnalysis, openJobPanel, stopGameJob } from '../job/actions';
import { useJobStore } from '../job/jobStore';
import { useScoringStore } from '../scoring/scoringStore';
import { engineAction, runEngineAction } from '../engine/engineAction';
import type { NavTarget } from '../transport/generated/NavTarget';
import type { Command, CommandContext, CommandId } from './registry';

/** PageUp and PageDown move this many moves, clamped to the line (audit G9). */
const PAGE = 10;

const press = (
  id: CommandId,
  run: (ctx: CommandContext) => void,
  options: Partial<Pick<Command, 'repeats' | 'scope'>> = {},
): Command => ({
  id,
  labelKey: `commands.${id}`,
  kind: 'press',
  repeats: false,
  scope: 'main',
  ...options,
  run: (ctx, phase) => {
    if (phase === 'down') run(ctx);
  },
});

const step = (id: CommandId, to: NavTarget) => press(id, (ctx) => ctx.go(to), { repeats: true });

const page = (id: CommandId, by: number) =>
  press(
    id,
    (ctx) => {
      const snapshot = useGameStore.getState().snapshot;
      if (!snapshot) return;
      ctx.go({ move: Math.max(0, Math.min(snapshot.lineLength, snapshot.moveNumber + by)) });
    },
    { repeats: true },
  );

/** Today's commands: the board's keys (design 5.7, M7 design 5.10) and the file chords. */
export const BUILTINS: Command[] = [
  step('nav.previousSibling', 'previousSibling'),
  step('nav.nextSibling', 'nextSibling'),
  press('nav.mainLine', (ctx) => ctx.go('mainLine')),
  press('nav.escape', (ctx) => {
    const modes = useModeStore.getState();
    if (modes.mode !== 'normal') modes.setMode('normal');
    else if (useGameStore.getState().snapshot?.tryout != null)
      void edit(ctx.actions, { kind: 'tryoutEnd' });
    else ctx.go('branchPoint');
  }),
  press('edit.undo', (ctx) => {
    if (useGameStore.getState().snapshot?.canUndo) void undo(ctx.actions);
  }),
  press('edit.redo', (ctx) => {
    if (useGameStore.getState().snapshot?.canRedo) void redo(ctx.actions);
  }),
  press('edit.tryout', (ctx) => {
    const snapshot = useGameStore.getState().snapshot;
    const { active, starting } = useScoringStore.getState();
    if (snapshot && !active && !starting)
      void edit(ctx.actions, { kind: snapshot.tryout === null ? 'tryoutStart' : 'tryoutEnd' });
  }),
  press('edit.deleteFrom', (ctx) => {
    const snapshot = useGameStore.getState().snapshot;
    if (snapshot && !snapshot.atStart)
      void edit(ctx.actions, { kind: 'deleteFrom', node: snapshot.node });
  }),
  step('nav.previous', 'previous'),
  step('nav.next', 'next'),
  step('nav.first', 'first'),
  step('nav.last', 'last'),
  page('nav.pageBack', -PAGE),
  page('nav.pageForward', PAGE),
  press('file.open', (ctx) => void openFromPicker(ctx.actions)),
  press('file.saveAs', (ctx) => void saveAs(ctx.actions)),
  press('file.new19', (ctx) => void startNewGame(ctx.actions, 19)),
  // What a click on the engine indicator does, except opening the wizard.
  press(
    'analysis.toggle',
    (ctx) => {
      const action = engineAction(ctx.engine.getState().engine, useJobStore.getState().progress);
      if (action !== 'setUp') runEngineAction(action, ctx.actions.transport);
    },
    { scope: 'always' },
  ),
  // P2 M2 design 5.10: the whole-game job, the cache, final scoring and the estimate.
  press('analysis.game', () => openJobPanel()),
  press('analysis.stopGame', (ctx) => void stopGameJob(ctx.actions)),
  press('analysis.clearPosition', (ctx) => void clearAnalysis(ctx.actions, 'position')),
  press('analysis.clearGame', (ctx) => void clearAnalysis(ctx.actions, 'game')),
  press(
    'scoring.start',
    (ctx) =>
      void useScoringStore
        .getState()
        .start({ transport: ctx.actions.transport, engine: ctx.engine, t: ctx.actions.t }),
  ),
  press('estimate.toggle', () => useEstimateStore.getState().toggle()),
  press('candidates.toggleHidden', () => useViewStore.getState().toggleHidden(), {
    scope: 'always',
  }),
  {
    id: 'candidates.peek',
    labelKey: 'commands.candidates.peek',
    kind: 'hold',
    repeats: true,
    scope: 'always',
    run: (_, phase) => useViewStore.getState().setHeld(phase === 'down'),
  },
];
