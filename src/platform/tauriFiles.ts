import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toTransportError } from '../transport/transport';
import type { DiscardChoice, MenuCommand, OpenedFile, PlatformFiles, RecentEntry } from './files';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toTransportError(error);
  }
}

/** Bytes as base64, in chunks small enough for `String.fromCharCode`'s arguments. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Calls `subscribe`, and unsubscribes even when that resolves after the caller gave up. */
function listening(subscribe: () => Promise<() => void>): () => void {
  let active = true;
  let stop: (() => void) | null = null;
  void subscribe().then((fn) => {
    if (active) stop = fn;
    else fn();
  });
  return () => {
    active = false;
    stop?.();
    stop = null;
  };
}

/** The desktop app's files: the `files_*` Tauri commands, the window title and its drops. */
export function createTauriFiles(): PlatformFiles {
  return {
    pickOpen: () => call<OpenedFile | null>('files_pick_open'),
    openPath: (path) => call<OpenedFile>('files_open_path', { path }),
    openRecent: (index) => call<OpenedFile>('files_open_recent', { index }),
    remember: (token, title) => call<void>('files_remember', { token, title }),
    recent: () => call<RecentEntry[]>('files_recent'),
    clearRecent: () => call<void>('files_clear_recent'),
    save: (token, bytes) => call<boolean>('files_save', { token, bytes }),
    confirmDiscard: () => call<DiscardChoice>('confirm_discard'),
    onQuitRequested: (handler) => listening(() => listen('app-quit-requested', handler)),
    quit: (expectedRevision) => call<void>('app_quit', { expectedRevision }),
    reread: (token) => call<string>('files_reread', { token }),
    saveAs: (suggestedName, text) => call<string | null>('files_save_as', { suggestedName, text }),
    saveImage: (suggestedName, bytes) =>
      call<boolean>('files_save_image', { suggestedName, bytes: toBase64(bytes) }),
    // The app writes the clipboard, not the webview: a click in the macOS menu bar is no click
    // in the page, and WebKit refuses a page's write without one.
    copyImage: async (bytes) => {
      try {
        await call<void>('files_copy_image', { bytes: toBase64(await bytes) });
        return true;
      } catch {
        return false;
      }
    },
    setAlwaysOnTop: (on) => getCurrentWindow().setAlwaysOnTop(on),
    setWindowTitle: (title) => getCurrentWindow().setTitle(title),
    setMenuLanguage: (language) => call<void>('menu_set_language', { language }),
    onDrag: (handler) =>
      listening(() =>
        getCurrentWebview().onDragDropEvent(({ payload }) => {
          if (payload.type === 'enter') handler({ kind: 'over', paths: payload.paths });
          else if (payload.type === 'over') handler({ kind: 'over' });
          else if (payload.type === 'leave') handler({ kind: 'leave' });
          else handler({ kind: 'drop', paths: payload.paths });
        }),
      ),
    onMenu: (handler) =>
      listening(() => listen<MenuCommand>('aji://menu', (event) => handler(event.payload))),
  };
}
