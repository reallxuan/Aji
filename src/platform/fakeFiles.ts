import { copyImage } from './clipboard';
import { TransportError } from '../transport/transport';
import type { DragEvent, MenuCommand, PlatformFiles, RecentEntry } from './files';

export interface FakeFilesOptions {
  /** Files on the fake disk, by path. */
  files?: Record<string, string>;
  /** The open dialog's answer. */
  pick?: string | null;
  /** The save dialog's answer. */
  savePath?: string | null;
  /** Paths already in the recent list, newest first. */
  recent?: string[];
}

export interface FakeFiles extends PlatformFiles {
  save(token: string, bytesBase64: string): Promise<boolean>;
  remembered: Array<{ path: string; title: string }>;
  written: Map<string, string>;
  /** Screenshots saved, by path. */
  images: Map<string, Uint8Array>;
  /** Every always-on-top state set, in order. */
  alwaysOnTop: boolean[];
  saveRequests: string[];
  titles: string[];
  menuLanguages: string[];
  /** Puts a file on the fake disk (a file dropped into the browser, in development). */
  put(path: string, text: string): void;
  emitDrag(event: DragEvent): void;
  emitMenu(command: MenuCommand): void;
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function utf8Base64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** In-memory files for tests and the development scenarios. A token is the file's path. */
export function createFakeFiles(options: FakeFilesOptions = {}): FakeFiles {
  const disk = new Map(
    Object.entries(options.files ?? {}).map(([path, text]) => [path, utf8Base64(text)]),
  );
  const recent: Array<{ path: string; title: string }> = (options.recent ?? []).map((path) => ({
    path,
    title: baseName(path),
  }));
  const drags = new Set<(event: DragEvent) => void>();
  const menus = new Set<(command: MenuCommand) => void>();

  async function open(path: string) {
    const name = baseName(path);
    if (!/\.sgf$/i.test(name)) throw new TransportError('fileNotSgf', `${name} is not .sgf`);
    const bytes = disk.get(path);
    if (bytes === undefined) throw new TransportError('fileMissing', `${path} is gone`);
    return { token: path, name, bytes };
  }

  const fake: FakeFiles = {
    remembered: [],
    written: new Map(),
    images: new Map(),
    alwaysOnTop: [],
    saveRequests: [],
    titles: [],
    menuLanguages: [],
    async pickOpen() {
      return options.pick ? open(options.pick) : null;
    },
    openPath: open,
    async openRecent(index) {
      const entry = recent[index];
      if (!entry) throw new TransportError('internal', `no recent file ${index}`);
      try {
        return await open(entry.path);
      } catch (error) {
        if (error instanceof TransportError && error.code === 'fileMissing')
          recent.splice(index, 1);
        throw error;
      }
    },
    async remember(token, title) {
      fake.remembered.push({ path: token, title });
      const at = recent.findIndex((e) => e.path === token);
      if (at >= 0) recent.splice(at, 1);
      recent.unshift({ path: token, title });
      recent.splice(10);
    },
    async recent(): Promise<RecentEntry[]> {
      return recent.map(({ path, title }, i) => ({
        title,
        name: baseName(path),
        path,
        openedAt: 1_795_132_800_000 - i * 60_000,
        missing: !disk.has(path),
      }));
    },
    async clearRecent() {
      recent.length = 0;
    },
    async save(token, bytes) {
      if (!disk.has(token)) return false;
      const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
      disk.set(token, bytes);
      fake.written.set(token, new TextDecoder().decode(data));
      return true;
    },
    async saveAs(suggestedName, text) {
      fake.saveRequests.push(suggestedName);
      const path = options.savePath === undefined ? `/fake/${suggestedName}` : options.savePath;
      if (path === null) return null;
      fake.written.set(path, text);
      disk.set(path, utf8Base64(text));
      return path;
    },
    async saveImage(suggestedName, bytes) {
      const path = options.savePath === undefined ? `/fake/${suggestedName}.png` : options.savePath;
      if (path === null) return false;
      fake.images.set(path, bytes);
      return true;
    },
    // The browser's own clipboard, as the development page has no app behind it.
    copyImage: (bytes) => copyImage(bytes),
    async setAlwaysOnTop(on) {
      fake.alwaysOnTop.push(on);
    },
    async setWindowTitle(title) {
      fake.titles.push(title);
    },
    async setMenuLanguage(language) {
      fake.menuLanguages.push(language);
    },
    onDrag(handler) {
      drags.add(handler);
      return () => drags.delete(handler);
    },
    onMenu(handler) {
      menus.add(handler);
      return () => menus.delete(handler);
    },
    put(path, text) {
      disk.set(path, utf8Base64(text));
    },
    emitDrag(event) {
      for (const handler of [...drags]) handler(event);
    },
    emitMenu(command) {
      for (const handler of [...menus]) handler(command);
    },
  };
  return fake;
}
