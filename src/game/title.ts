import type { TFunction } from 'i18next';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';

const present = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/**
 * The game's title (design 5.4): its name (`GN`); else the event and round; else the players;
 * else the file name; else untitled.
 */
export function gameTitle(snapshot: GameSnapshot | null, t: TFunction): string {
  const info = snapshot?.info;
  const name = present(info?.gameName);
  if (name) return name;
  const event = [present(info?.event), present(info?.round)].filter(Boolean).join(' ');
  if (event) return event;
  const black = present(info?.black);
  const white = present(info?.white);
  if (black || white) return t('game.players', { black: black ?? '?', white: white ?? '?' });
  return present(snapshot?.name) ?? t('panel.untitled');
}

/** `Aji — <title>`, or `Aji` alone for a new game with nothing in it yet. */
export function windowTitle(snapshot: GameSnapshot | null, t: TFunction): string {
  const title = gameTitle(snapshot, t);
  const blank =
    !snapshot || (!snapshot.hasMoves && snapshot.name === null && title === t('panel.untitled'));
  const base = blank ? 'Aji' : `Aji — ${title}`;
  return snapshot?.changed ? `${base} (${t('title.changed')})` : base;
}

/** A file name for saving under `title`: characters no file system allows become `_`. */
export function fileNameFor(title: string): string {
  const safe = [...title]
    .map((c) => (c < ' ' || '\\/:*?"<>|'.includes(c) ? '_' : c))
    .join('')
    .trim()
    .replace(/[. ]+$/, '');
  return `${safe || 'game'}.sgf`;
}
