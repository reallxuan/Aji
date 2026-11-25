import { useEffect } from 'react';
import { create } from 'zustand';
import { useTransport } from '../transport/TransportProvider';
import type { ConsoleLine } from '../transport/generated/ConsoleLine';
import type { ConsoleRefusal } from '../transport/generated/ConsoleRefusal';

/** Why the console sent nothing: the engine's refusal, or no KataGo running. */
export type ConsoleWhy = ConsoleRefusal | 'notRunning';

/**
 * A line as the console shows it. A query the backend refused is noted here only, with a
 * negative `seq`, since the backend keeps no line for it.
 */
export type ShownLine = ConsoleLine & { refused?: ConsoleWhy };

/**
 * The backend's kept lines (design 6.5): 1,000 of stderr and Aji's notes, 5,000 of the protocol.
 * Kept apart, so a busy analysis does not push KataGo's start-up lines out of the log.
 */
export const CONSOLE_KEPT = { log: 1000, protocol: 5000 } as const;

const isProtocol = (line: ConsoleLine) => line.kind === 'sent' || line.kind === 'received';

/** The newest lines of each kind, within their caps, in their order. */
function kept(lines: ShownLine[]): ShownLine[] {
  let log = 0;
  let protocol = 0;
  const keep = lines.map(() => false);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isProtocol(lines[i])) keep[i] = ++protocol <= CONSOLE_KEPT.protocol;
    else keep[i] = ++log <= CONSOLE_KEPT.log;
  }
  return lines.filter((_, i) => keep[i]);
}
/** How many sent queries Up and Down recall. */
const HISTORY_KEPT = 100;

export type ConsoleFilter = 'all' | 'log' | 'protocol';

/** The engine console's lines and view (P2 M4 design 6.5). */
export interface ConsoleState {
  /** Oldest first, each kind within {@link CONSOLE_KEPT}. */
  lines: ShownLine[];
  /** The newest `seq` seen. */
  after: number;
  /** 清空 hid every line up to this `seq`: a reload does not bring them back. */
  cleared: number;
  filter: ConsoleFilter;
  /** 暂停滚动: the list stays where it is while lines arrive. */
  paused: boolean;
  /** Sent queries, oldest first, for Up and Down. */
  history: string[];
  append(lines: ConsoleLine[]): void;
  /** Notes a query the console did not send. */
  refused(why: ConsoleWhy): void;
  /** 清空: hides what has arrived. The backend keeps its lines. */
  clear(): void;
  setFilter(filter: ConsoleFilter): void;
  setPaused(paused: boolean): void;
  remember(query: string): void;
}

let nextLocal = 0;

const initial = {
  lines: [] as ShownLine[],
  after: 0,
  cleared: 0,
  filter: 'all' as ConsoleFilter,
  paused: false,
  history: [] as string[],
};

export const useConsoleStore = create<ConsoleState>()((set) => ({
  ...initial,
  // A reload can bring lines older than the newest seen: KataGo's start-up lines come before the
  // interface subscribes. They go in by time, so the list stays in order.
  append: (incoming) =>
    set((s) => {
      const have = new Set(s.lines.map((line) => line.seq));
      const fresh = incoming.filter((line) => line.seq > s.cleared && !have.has(line.seq));
      if (fresh.length === 0) return s;
      const lines = [...s.lines, ...fresh];
      if (fresh.some((line) => line.seq < s.after))
        lines.sort((a, b) => a.atMs - b.atMs || a.seq - b.seq);
      const newest = Math.max(s.after, ...fresh.map((line) => line.seq));
      return { lines: kept(lines), after: newest };
    }),
  refused: (why) =>
    set((s) => ({
      lines: kept([
        ...s.lines,
        { seq: --nextLocal, atMs: Date.now(), kind: 'aji' as const, text: '', refused: why },
      ]),
    })),
  clear: () => set((s) => ({ lines: [], cleared: s.after })),
  setFilter: (filter) => set({ filter }),
  setPaused: (paused) => set({ paused }),
  remember: (query) =>
    set((s) =>
      s.history.at(-1) === query ? s : { history: [...s.history, query].slice(-HISTORY_KEPT) },
    ),
}));

/** Empty, with the default view. For tests. */
export function resetConsoleStore(): void {
  useConsoleStore.setState(initial);
}

/** Appends the lines `engineConsoleLines` events carry. */
export function useConsoleSync(): void {
  const transport = useTransport();
  useEffect(
    () =>
      transport.subscribe((event) => {
        if (event.type === 'engineConsoleLines') useConsoleStore.getState().append(event.lines);
      }),
    [transport],
  );
}
