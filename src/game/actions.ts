import type { TFunction } from 'i18next';
import type { MenuCommand, OpenedFile, PlatformFiles } from '../platform/files';
import {
  exportGame,
  navigateGame,
  newGame,
  openGame,
  setGameRules,
  type GameReply,
} from '../transport/api';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { GameWarning } from '../transport/generated/GameWarning';
import type { NavTarget } from '../transport/generated/NavTarget';
import type { Transport } from '../transport/transport';
import { useGameStore } from './gameStore';
import { useNoticeStore } from './noticeStore';
import { errorNotice, warningNotice } from './notices';
import { fileNameFor, gameTitle } from './title';
import { PRESET_IDS, presetLayout } from '../layout/presets';
import { setLayout } from '../layout/useLayout';

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

/** Sends a read file to `gameOpen`; only an opened game enters the recent list. */
async function openFile(ctx: ActionContext, file: OpenedFile): Promise<void> {
  let reply: GameReply;
  try {
    reply = await openGame(ctx.transport, file.name, file.bytes);
  } catch (error) {
    fail(ctx.t, ctx.t('notice.openFailed', { name: file.name }), error);
    return;
  }
  const snapshot = apply(reply);
  showWarnings(reply.warnings, snapshot, ctx.t);
  await ctx.files.remember(file.token, gameTitle(snapshot, ctx.t)).catch(() => {
    // The game is open; only the recent list missed it.
  });
}

export async function openFromPicker(ctx: ActionContext): Promise<void> {
  let file: OpenedFile | null;
  try {
    file = await ctx.files.pickOpen();
  } catch (error) {
    fail(ctx.t, ctx.t('notice.openFailed', { name: '' }).trim(), error);
    return;
  }
  if (file) await openFile(ctx, file);
}

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
  try {
    await openFile(ctx, await ctx.files.openPath(path));
  } catch (error) {
    fail(ctx.t, ctx.t('notice.openFailed', { name }), error);
  }
}

export async function openRecent(ctx: ActionContext, index: number): Promise<void> {
  const entries = await ctx.files.recent().catch(() => []);
  const name = entries[index]?.name ?? '';
  let file: OpenedFile;
  try {
    file = await ctx.files.openRecent(index);
  } catch (error) {
    fail(ctx.t, ctx.t('notice.openFailed', { name }), error);
    return;
  }
  await openFile(ctx, file);
}

/** Exports the game, asks where to save it under its title, writes it and remembers it. */
export async function saveAs(ctx: ActionContext): Promise<void> {
  const failed = (error: unknown) => fail(ctx.t, ctx.t('notice.saveFailed'), error);
  let text: string;
  try {
    ({ text } = await exportGame(ctx.transport));
  } catch (error) {
    failed(error);
    return;
  }
  const title = gameTitle(useGameStore.getState().snapshot, ctx.t);
  let token: string | null;
  try {
    token = await ctx.files.saveAs(fileNameFor(title), text);
  } catch (error) {
    failed(error);
    return;
  }
  if (token) await ctx.files.remember(token, title).catch(() => {});
}

async function change(ctx: ActionContext, request: () => Promise<GameReply>): Promise<void> {
  try {
    apply(await request());
  } catch (error) {
    fail(ctx.t, ctx.t('notice.gameFailed'), error);
  }
}

export const startNewGame = (ctx: ActionContext, size: number) =>
  change(ctx, () => newGame(ctx.transport, size));

export const navigate = (ctx: ActionContext, to: NavTarget) =>
  change(ctx, () => navigateGame(ctx.transport, to));

/** `null` goes back to the file's reading. */
export const setRules = (ctx: ActionContext, rules: AnalysisRules | null) =>
  change(ctx, () => setGameRules(ctx.transport, rules));

/** What a menu bar item does: the same actions as the title menu, and the 布局 presets. */
export function runMenuCommand(ctx: ActionContext, command: MenuCommand): Promise<void> {
  if (typeof command === 'object' && 'layout' in command) {
    const id = PRESET_IDS.find((preset) => preset === command.layout);
    if (id) setLayout(presetLayout(id));
    return Promise.resolve();
  }
  if (typeof command === 'object') return openRecent(ctx, command.recent);
  switch (command) {
    case 'new19':
      return startNewGame(ctx, 19);
    case 'new13':
      return startNewGame(ctx, 13);
    case 'new9':
      return startNewGame(ctx, 9);
    case 'open':
      return openFromPicker(ctx);
    case 'saveAs':
      return saveAs(ctx);
    case 'clearRecent':
      return ctx.files.clearRecent().catch(() => {});
  }
}
