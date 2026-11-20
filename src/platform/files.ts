import type { MenuAction } from '../transport/generated/MenuAction';
import type { OpenedFile } from '../transport/generated/OpenedFile';
import type { RecentEntry } from '../transport/generated/RecentEntry';

export type { MenuAction as MenuCommand, OpenedFile, RecentEntry };

/** A drag over the window. `over` carries the paths when the system gives them (on entering). */
export type DragEvent =
  { kind: 'over'; paths?: string[] } | { kind: 'leave' } | { kind: 'drop'; paths: string[] };

/**
 * What the interface needs from the system to open and save game files. The desktop app does it
 * with Tauri commands (design 5.6); a browser client would use a file input, drops and a download
 * link instead. Paths stay on the other side: an opened file comes back with a token to remember.
 */
export interface PlatformFiles {
  /** The open dialog; `null` when the user cancels. */
  pickOpen(): Promise<OpenedFile | null>;
  /** A file dropped on the window. */
  openPath(path: string): Promise<OpenedFile>;
  openRecent(index: number): Promise<OpenedFile>;
  /** Puts the opened or saved file behind `token` at the top of the recent list. */
  remember(token: string, title: string): Promise<void>;
  recent(): Promise<RecentEntry[]>;
  clearRecent(): Promise<void>;
  /** The save dialog, then the write; the saved file's token, or `null` when cancelled. */
  saveAs(suggestedName: string, text: string): Promise<string | null>;
  setWindowTitle(title: string): Promise<void>;
  /** The language the menu bar should use. */
  setMenuLanguage(language: 'zh-CN' | 'en'): Promise<void>;
  onDrag(handler: (event: DragEvent) => void): () => void;
  onMenu(handler: (command: MenuAction) => void): () => void;
}
