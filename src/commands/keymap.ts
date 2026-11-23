import type { OsKind } from '../transport/generated/OsKind';
import { type CommandId, isCommandId } from './registry';

/**
 * A key as a chord string: modifiers in a fixed order, then the key, as in `ArrowLeft`, `Mod+O`
 * or `Shift+Mod+S`. `Mod` is ⌘ on macOS and Ctrl elsewhere; letters are upper case.
 */
export function chordOf(event: KeyboardEvent, os: OsKind | null): string {
  const mac = os === 'macos';
  const parts: string[] = [];
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  if (mac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  if (mac ? event.ctrlKey : event.metaKey) parts.push(mac ? 'Ctrl' : 'Meta');
  parts.push(keyName(event.key));
  return parts.join('+');
}

/** `event.key` as a keymap names it: Space for ' ', letters upper case. */
export function keyName(key: string): string {
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

const BOARD: Array<[string, CommandId]> = [
  ['ArrowLeft', 'nav.previous'],
  ['ArrowUp', 'nav.previous'],
  ['ArrowRight', 'nav.next'],
  ['ArrowDown', 'nav.next'],
  ['Home', 'nav.first'],
  ['End', 'nav.last'],
  ['PageUp', 'nav.pageBack'],
  ['PageDown', 'nav.pageForward'],
  ['Space', 'analysis.toggle'],
  ['F', 'candidates.toggleHidden'],
  ['Z', 'candidates.peek'],
  ['T', 'estimate.toggle'],
];

const FILE: Array<[string, CommandId]> = [
  ['Mod+O', 'file.open'],
  ['Shift+Mod+S', 'file.saveAs'],
  ['Mod+N', 'file.new19'],
];

/**
 * The keys out of the box (P2 M1 design 5.11). On macOS, and until the system is known, the file
 * chords are left out: the native menu bar owns ⌘O, ⇧⌘S and ⌘N, and ⇧⌘A (分析全局…, P2 M2).
 * Elsewhere 分析全局… has no key.
 */
export function defaultKeymap(os: OsKind | null): Map<string, CommandId> {
  return new Map(os === null || os === 'macos' ? BOARD : [...BOARD, ...FILE]);
}

/** The defaults with the device's overrides on top; an override naming no command is ignored. */
export function resolveKeymap(
  os: OsKind | null,
  overrides: Record<string, string>,
): Map<string, CommandId> {
  const keymap = defaultKeymap(os);
  for (const [chord, id] of Object.entries(overrides)) if (isCommandId(id)) keymap.set(chord, id);
  return keymap;
}
