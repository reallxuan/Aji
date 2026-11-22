import { boardImage } from '../board/snapshotImage';
import { useNoticeStore } from '../game/noticeStore';
import type { PlatformFiles } from '../platform/files';
import { graphImage } from './graphImage';

export type ShotTarget = 'board' | 'subboard' | 'graph';
export const TARGETS: ShotTarget[] = ['board', 'subboard', 'graph'];
/** A translation function: i18next's, or a stand-in in tests. */
export type Translate = (key: string, options?: { target: string }) => string;

/** What a target captures on screen now: a board's canvas host, or the graph's SVG. */
export function find(target: ShotTarget): Element | null {
  if (target === 'board') return document.querySelector('[data-board] > div');
  if (target === 'graph') return document.querySelector('svg[data-trend-graph]');
  // The lowest-ranked sub-board shown.
  const boards = [...document.querySelectorAll<HTMLElement>('[data-subboard]')].sort(
    (a, b) => Number(a.dataset.subboard) - Number(b.dataset.subboard),
  );
  for (const board of boards) {
    const host = board.querySelector('[data-subboard-board] > div');
    if (host) return host;
  }
  return null;
}

function image(target: ShotTarget, element: Element): Promise<Uint8Array> {
  if (target !== 'graph') return boardImage(element as HTMLElement);
  const panel = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
  return graphImage(element as SVGSVGElement, panel || '#ffffff');
}

const warn = (title: string) => useNoticeStore.getState().show({ kind: 'warning', title });

/** Saves `target` as a PNG named after the game; `false` when it is not shown or cancelled. */
export async function saveShot(
  target: ShotTarget,
  files: PlatformFiles,
  title: string,
  t: Translate,
): Promise<boolean> {
  const element = find(target);
  if (!element) return false;
  try {
    return await files.saveImage(
      `${title} ${t(`screenshot.targets.${target}`)}`,
      await image(target, element),
    );
  } catch {
    warn(t('screenshot.saveFailed'));
    return false;
  }
}

/**
 * Copies `target` to the clipboard, or says it could not. Call it straight from the click: the
 * webview's clipboard write must start while the click is being handled.
 */
export async function copyShot(
  target: ShotTarget,
  files: PlatformFiles,
  t: Translate,
): Promise<boolean> {
  const element = find(target);
  if (!element) return false;
  const copied = await files.copyImage(image(target, element));
  if (!copied) warn(t('screenshot.copyFailed'));
  return copied;
}

/**
 * 文件 → 导出图片 in the macOS menu bar (owner, 2026-11-22): saves or copies `target`, or says it
 * is not on screen, since the menu bar cannot grey out what the page shows.
 */
export async function shotFromMenu(
  kind: 'save' | 'copy',
  target: string,
  files: PlatformFiles,
  title: string,
  t: Translate,
): Promise<void> {
  const shot = TARGETS.find((known) => known === target);
  if (!shot) return;
  if (!find(shot)) {
    warn(t('screenshot.notShown', { target: t(`screenshot.targets.${shot}`) }));
    return;
  }
  await (kind === 'save' ? saveShot(shot, files, title, t) : copyShot(shot, files, t));
}
