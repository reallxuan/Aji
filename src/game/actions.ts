import type { TFunction } from 'i18next';
import type { EngineStore } from '../engine/engineStore';
import type { MenuCommand, OpenedFile, PlatformFiles } from '../platform/files';
import {
  exportGame,
  getGameSnapshot,
  markSaved,
  navigateGame,
  newGame,
  openGame,
  type GameReply,
} from '../transport/api';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { GameWarning } from '../transport/generated/GameWarning';
import type { NavTarget } from '../transport/generated/NavTarget';
import { TransportError, toTransportError, type Transport } from '../transport/transport';
import { discardFailedRecordFields, flushRecordFields, recordFieldVersion } from './fieldWrites';
import { busy, isTextEditor } from './busy';
import { commitRecord, drainMutations, mutationsPending, recordLocked } from './recordMutations';
import { edit, undo, redo } from './editActions';
import { useGameStore } from './gameStore';
import { useNoticeStore } from './noticeStore';
import { errorNotice, warningNotice } from './notices';
import { fileNameFor, gameTitle } from './title';
import { PRESET_IDS, presetLayout } from '../layout/presets';
import { setLayout } from '../layout/useLayout';
import { shotFromMenu } from '../panel/screenshots';
import { useEstimateStore } from '../analysis/estimateStore';
import { clearAnalysis, openJobPanel, stopGameJob } from '../job/actions';
import { useScoringStore } from '../scoring/scoringStore';

export interface ActionContext {
  transport: Transport;
  files: PlatformFiles;
  t: TFunction;
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function fail(t: TFunction, title: string, error: unknown): void {
  useNoticeStore.getState().show(errorNotice(title, error, t));
}

function showWarnings(warnings: GameWarning[], snapshot: GameSnapshot, t: TFunction): void {
  const notice = warningNotice(warnings, snapshot, t);
  if (notice) useNoticeStore.getState().show(notice);
}

function apply(reply: GameReply): GameSnapshot {
  useGameStore.getState().apply(reply.snapshot);
  return reply.snapshot;
}

type Commit = (revision: number) => Promise<void>;
const diskVersions = new WeakMap<Transport, number>();
const diskVersion = (ctx: ActionContext) => diskVersions.get(ctx.transport) ?? 0;

async function openSelected(ctx: ActionContext, read: () => Promise<OpenedFile | null>, name = '') {
  let selected = name;
  try {
    await beforeLeaving(ctx, 'open', async () => {
      const before = diskVersion(ctx);
      const file = await read();
      if (!file) return null;
      selected = file.name;
      return async (revision) => {
        // A finished write can supersede the bytes read by the picker or drop,
        // even when it exported a copy without changing the record revision.
        const bytes = diskVersion(ctx) === before ? file.bytes : await ctx.files.reread(file.token);
        const reply = await openGame(ctx.transport, file.name, bytes, revision);
        const snapshot = apply(reply);
        if (currentGame() !== snapshot.gameRevision) return;
        useGameStore.setState({ fileToken: file.token });
        showWarnings(reply.warnings, snapshot, ctx.t);
        await ctx.files.remember(file.token, gameTitle(snapshot, ctx.t)).catch(() => {});
      };
    });
  } catch (error) {
    fail(ctx.t, ctx.t('notice.openFailed', { name: selected }).trim(), error);
  }
}

export const openFromPicker = (ctx: ActionContext) => openSelected(ctx, () => ctx.files.pickOpen());

/** Opens the first of the dropped files. */
export async function openDropped(ctx: ActionContext, paths: string[]): Promise<void> {
  const path = paths[0];
  if (!path) return;
  const name = baseName(path);
  if (!/\.sgf$/i.test(name)) {
    useNoticeStore.getState().show({
      kind: 'error',
      title: ctx.t('notice.openFailed', { name }),
      detail: ctx.t('errors.fileNotSgf'),
    });
    return;
  }
  await openSelected(ctx, () => ctx.files.openPath(path), name);
}

export async function openRecent(ctx: ActionContext, index: number): Promise<void> {
  // Saving from the prompt can move the current record to the top of the list.
  const entry = (await ctx.files.recent().catch(() => []))[index];
  if (!entry) return;
  await openSelected(
    ctx,
    async () => {
      const entries = await ctx.files.recent();
      const at = entries.findIndex((e) => e.path === entry.path);
      return at < 0 ? ctx.files.openPath(entry.path) : ctx.files.openRecent(at);
    },
    entry.name,
  );
}

const currentGame = () => useGameStore.getState().snapshot?.gameRevision;
type SaveKind = 'save' | 'saveAs' | 'branch' | 'clean';

async function writeRecord(
  ctx: ActionContext,
  kind: SaveKind,
  game: number | undefined,
): Promise<boolean> {
  try {
    if (game === undefined || currentGame() !== game || !(await settleRecord(ctx)).flushed)
      return false;
    const { snapshot, fileToken } = useGameStore.getState();
    if (snapshot?.gameRevision !== game) return false;
    const inPlace = kind === 'save' && fileToken !== null && !snapshot.saveAsFirst;
    const title = gameTitle(snapshot, ctx.t);
    const out = await exportGame(ctx.transport, {
      scope: kind === 'branch' ? 'branch' : 'game',
      clean: kind === 'clean',
      inPlace,
    });
    if (out.gameRevision !== game || currentGame() !== game) return false;
    let token = fileToken;
    if (inPlace) {
      if (out.bytes === null || !(await ctx.files.save(fileToken, out.bytes)))
        throw new TransportError('fileWriteFailed', 'Could not write the exported bytes');
    } else {
      if (out.text === null) throw new TransportError('internal', 'Save As export is missing text');
      token = await ctx.files.saveAs(fileNameFor(title), out.text);
      if (!token) return false;
    }
    diskVersions.set(ctx.transport, diskVersion(ctx) + 1);
    if (currentGame() !== game) return false;
    if (kind === 'branch' || kind === 'clean') return true;
    apply(await markSaved(ctx.transport, game, out.editId, !inPlace || out.fellBack));
    if (currentGame() !== game) return false;
    if (!inPlace && token) {
      useGameStore.setState({ fileToken: token });
      await ctx.files.remember(token, title).catch(() => {});
    }
    if (out.fellBack)
      useNoticeStore.getState().show({ kind: 'warning', title: ctx.t('notice.savedAsUtf8') });
    return true;
  } catch (error) {
    const notice = errorNotice(ctx.t('notice.saveFailed'), error, ctx.t);
    if (toTransportError(error).code === 'sgfTooLarge')
      notice.detail = ctx.t('notice.saveTooLarge');
    useNoticeStore.getState().show(notice);
    return false;
  }
}

// Two writes to the same destination must reach disk and acknowledge their edits in order.
const saves = new WeakMap<Transport, Promise<boolean>>();
function saveRecord(ctx: ActionContext, kind: SaveKind): Promise<boolean> {
  if (recordLocked(ctx.transport)) return Promise.resolve(false);
  const game = currentGame();
  const run = () => writeRecord(ctx, kind, game);
  const pending = saves.get(ctx.transport);
  const write = pending ? pending.then(run) : run();
  saves.set(ctx.transport, write);
  return write.finally(() => {
    if (saves.get(ctx.transport) === write) saves.delete(ctx.transport);
  });
}

export const save = (ctx: ActionContext) => saveRecord(ctx, 'save');
export const saveAs = (ctx: ActionContext) => saveRecord(ctx, 'saveAs');
export const saveBranch = (ctx: ActionContext) => saveRecord(ctx, 'branch');
export const saveClean = (ctx: ActionContext) => saveRecord(ctx, 'clean');

function recordState(ctx: ActionContext) {
  const fields = recordFieldVersion(ctx.transport);
  return { snapshot: useGameStore.getState().snapshot, fields };
}
type Approval = ReturnType<typeof recordState>;
const sameState = (a: Approval, b: Approval) => a.snapshot === b.snapshot && a.fields === b.fields;

/** A queued setup/mark or delayed undo can make a previously clean record dirty.
 * Wait through application of the snapshot as well as commits of mounted editors. */
async function settleRecord(ctx: ActionContext) {
  for (;;) {
    await drainMutations(ctx.transport);
    const flushed = await flushRecordFields(ctx.transport);
    const state = recordState(ctx);
    if (!mutationsPending(ctx.transport)) return { state, flushed };
  }
}

async function approve(ctx: ActionContext, prior?: Approval): Promise<Approval | null> {
  const game = currentGame();
  const { state, flushed } = await settleRecord(ctx);
  if (currentGame() !== game) return null;
  if ((prior && sameState(state, prior)) || (flushed && !state.snapshot?.changed)) return state;
  const answer = await ctx.files.confirmDiscard();
  if (currentGame() !== game || answer === 'cancel') return null;
  if (answer === 'discard') {
    // This decision covers the edits the prompt was opened for.
    if (sameState(recordState(ctx), state) && !mutationsPending(ctx.transport)) return state;
    return approve(ctx);
  }
  if (!(await save(ctx))) return null;
  const after = await settleRecord(ctx);
  return after.flushed && currentGame() === game && !after.state.snapshot?.changed
    ? after.state
    : null;
}

export const confirmDiscard = async (ctx: ActionContext) => (await approve(ctx)) !== null;

// One pending decision belongs to one operation. File picking and saving leave the
// board interactive. The final RPC checks the approved revision under the service lock.
const leaving = new WeakSet<Transport>();
async function beforeLeaving(
  ctx: ActionContext,
  action: 'open' | 'new' | 'quit',
  prepare: () => Promise<Commit | null>,
) {
  if (leaving.has(ctx.transport)) return;
  leaving.add(ctx.transport);
  try {
    let approved = await approve(ctx);
    if (!approved) return;
    const original = approved.snapshot?.gameRevision;
    const commit = await prepare();
    if (!commit) return;
    for (;;) {
      if (original !== undefined && currentGame() !== original) return;
      if (!sameState(approved, recordState(ctx)) || mutationsPending(ctx.transport)) {
        approved = await approve(ctx, approved);
        if (!approved) return;
        continue;
      }
      // Any previously requested Save As or copy might target the selected file.
      // Wait outside the commit lock so queued writes and a prompt's own Save can finish.
      const writing = action === 'open' && saves.get(ctx.transport);
      if (writing) {
        await writing;
        continue;
      }
      try {
        const revision = approved.snapshot?.revision ?? 0;
        await commitRecord(ctx.transport, () => commit(revision));
        return;
      } catch (cause) {
        if (toTransportError(cause).code !== 'gameChanged') throw cause;
        const latest = apply(await getGameSnapshot(ctx.transport));
        if (latest.revision === approved.snapshot?.revision) throw cause;
      }
    }
  } finally {
    leaving.delete(ctx.transport);
  }
}

export async function requestQuit(ctx: ActionContext) {
  try {
    await beforeLeaving(ctx, 'quit', async () => async (revision) => {
      const game = currentGame();
      await ctx.files.quit(revision);
      if (game !== undefined) discardFailedRecordFields(ctx.transport, game);
    });
  } catch (error) {
    fail(ctx.t, ctx.t('notice.gameFailed'), error);
  }
}

async function change(
  ctx: ActionContext,
  request: () => Promise<GameReply>,
): Promise<GameSnapshot | null> {
  try {
    return apply(await request());
  } catch (error) {
    fail(ctx.t, ctx.t('notice.gameFailed'), error);
    return null;
  }
}

export async function startNewGame(ctx: ActionContext, size: number): Promise<void> {
  try {
    await beforeLeaving(ctx, 'new', async () => async (revision) => {
      apply(await newGame(ctx.transport, size, revision));
    });
  } catch (error) {
    fail(ctx.t, ctx.t('notice.gameFailed'), error);
  }
}

export const navigate = (ctx: ActionContext, to: NavTarget) =>
  change(ctx, () => navigateGame(ctx.transport, to));

/** `null` goes back to the file's reading. */
export async function setRules(ctx: ActionContext, rules: AnalysisRules | null): Promise<void> {
  await edit(ctx, { kind: 'setRules', rules });
}

/**
 * What a menu bar item does: the same actions as the title menu, and the 布局 presets. `engine`
 * tells final scoring whether analysis runs, to pause it.
 */
export async function runMenuCommand(
  ctx: ActionContext,
  command: MenuCommand,
  engine: EngineStore,
): Promise<void> {
  if (typeof command === 'object' && 'layout' in command) {
    const id = PRESET_IDS.find((preset) => preset === command.layout);
    if (id) setLayout(presetLayout(id));
    return Promise.resolve();
  }
  if (typeof command === 'object' && ('saveImage' in command || 'copyImage' in command)) {
    const [kind, target] =
      'saveImage' in command
        ? (['save', command.saveImage] as const)
        : (['copy', command.copyImage] as const);
    const title = gameTitle(useGameStore.getState().snapshot, ctx.t);
    const t = (key: string, options?: { target: string }) =>
      options ? ctx.t(key, options) : ctx.t(key);
    return shotFromMenu(kind, target, ctx.files, title, t);
  }
  if (typeof command === 'object')
    return 'new' in command ? startNewGame(ctx, command.new) : openRecent(ctx, command.recent);
  switch (command) {
    case 'open':
      return openFromPicker(ctx);
    case 'save':
    case 'saveAs':
    case 'saveBranch':
    case 'saveClean':
      await { save, saveAs, saveBranch, saveClean }[command](ctx);
      return;
    case 'quit':
      return requestQuit(ctx);
    case 'undo':
    case 'redo': {
      if (recordLocked(ctx.transport)) return;
      const target = document.activeElement;
      if (isTextEditor(target)) {
        document.execCommand(command);
        return Promise.resolve();
      }
      const snapshot = useGameStore.getState().snapshot;
      if (!busy(target) && (command === 'undo' ? snapshot?.canUndo : snapshot?.canRedo))
        await (command === 'undo' ? undo(ctx) : redo(ctx));
      return Promise.resolve();
    }
    case 'clearRecent':
      return ctx.files.clearRecent().catch(() => {});
    case 'analyseGame':
      openJobPanel();
      return Promise.resolve();
    case 'stopGame':
      return stopGameJob(ctx);
    case 'clearPosition':
      return clearAnalysis(ctx, 'position');
    case 'clearGame':
      return clearAnalysis(ctx, 'game');
    case 'finalScoring':
      return useScoringStore.getState().start({ transport: ctx.transport, engine, t: ctx.t });
    case 'estimate':
      useEstimateStore.getState().toggle();
      return Promise.resolve();
  }
}
