import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toTransportError } from '../transport/transport';
import type { MenuCommand, OpenedFile, PlatformFiles, RecentEntry } from './files';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toTransportError(error);
  }
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
    saveAs: (suggestedName, text) => call<string | null>('files_save_as', { suggestedName, text }),
    setWindowTitle: (title) => getCurrentWindow().setTitle(title),
    setMenuLanguage: (language) => call<void>('menu_set_language', { language }),
    onDrag: (handler) =>
      listening(() =>
        getCurrentWebview().onDragDropEvent(({ payload }) => {
          if (payload.type === 'enter' || payload.type === 'over') handler({ kind: 'over' });
          else if (payload.type === 'leave') handler({ kind: 'leave' });
          else handler({ kind: 'drop', paths: payload.paths });
        }),
      ),
    onMenu: (handler) =>
      listening(() => listen<MenuCommand>('aji://menu', (event) => handler(event.payload))),
  };
}
