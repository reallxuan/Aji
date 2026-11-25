// The scenario transport's engine profiles and console (P2 M4 design 6): a second managed
// profile beside the scenario's installed engine, own-files profiles, and a console that keeps
// stderr lines always and protocol lines while it is open, as the backend does.

import type { ActiveSummary } from '../transport/generated/ActiveSummary';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { ConsoleKind } from '../transport/generated/ConsoleKind';
import type { ConsoleLine } from '../transport/generated/ConsoleLine';
import type { ConsoleNote } from '../transport/generated/ConsoleNote';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import type { RunningEngine } from '../transport/generated/RunningEngine';
import { TransportError } from '../transport/transport';

/** The second profile: the network the mockup switches to, never measured. */
const ZHIZI = 'kata1-zhizi-b40c768nbt-s11272M';
/** Where the fake file dialog says the user's own files are. */
export const PICKED = {
  katago: '/opt/homebrew/bin/katago',
  model: '/Users/me/models/kata1-b28c512nbt-s13255M.bin.gz',
  config: '/opt/homebrew/share/katago/configs/analysis_example.cfg',
} as const;

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const modelName = (path: string) => fileName(path).replace(/\.(bin|txt)\.gz$|\.gz$/, '');

export function createFakeProfiles(active: ActiveSummary | null) {
  let profiles: ProfileSummary[] = [];
  let nextOwn = 1;
  if (active) {
    const managed = (network: string, networkName: string, visitsPerSecond: number | null) => ({
      kind: 'managed' as const,
      engine: active.engine,
      version: active.version,
      backend: active.backend,
      network,
      networkName,
      threads: active.threads,
      visitsPerSecond,
    });
    profiles = [
      {
        id: `${active.engine}/${active.network}`,
        name: active.networkName,
        current: true,
        source: managed(active.network, active.networkName, active.visitsPerSecond),
      },
      {
        id: `${active.engine}/${ZHIZI}`,
        name: 'zhizi b40',
        current: false,
        source: managed(ZHIZI, ZHIZI, null),
      },
    ];
  }

  const find = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) throw new TransportError('engineNoSuchProfile', `no profile ${id}`);
    return profile;
  };
  const makeCurrent = (id: string) => {
    profiles = profiles.map((p) => ({ ...p, current: p.id === id }));
  };

  return {
    list: () => structuredClone(profiles),
    current: () => profiles.find((p) => p.current) ?? null,
    /** What the engine card names. */
    running(): RunningEngine | null {
      const current = profiles.find((p) => p.current);
      if (!current) return null;
      return current.source.kind === 'managed'
        ? {
            backend: current.source.backend,
            networkName: current.source.networkName,
            profile: current.name,
          }
        : { backend: null, networkName: fileName(current.source.model), profile: current.name };
    },
    switchTo(id: string) {
      find(id);
      makeCurrent(id);
    },
    rename(id: string, name: string) {
      const profile = find(id);
      const trimmed = name.trim();
      profile.name =
        trimmed ||
        (profile.source.kind === 'managed'
          ? profile.source.networkName
          : modelName(profile.source.model));
    },
    remove(id: string) {
      if (find(id).current)
        throw new TransportError('engineProfileCurrent', 'the current profile stays');
      profiles = profiles.filter((p) => p.id !== id);
    },
    /** Refuses a file whose path says `missing`, as the backend refuses a missing file. */
    addOwn(files: { katago: string; model: string; config: string; name?: string }) {
      for (const file of ['katago', 'model', 'config'] as const) {
        if (files[file].includes('missing'))
          throw new TransportError('engineOwnFile', `${file} is missing`, `${file}:missing`);
      }
      const id = `own-${nextOwn++}`;
      profiles.push({
        id,
        name: files.name?.trim() || modelName(files.model),
        current: false,
        source: { kind: 'own', katago: files.katago, model: files.model, config: files.config },
      });
      makeCurrent(id);
      return id;
    },
  };
}

export type FakeProfiles = ReturnType<typeof createFakeProfiles>;

/** The backend's kept lines (design 6.5). */
const LOG_LINES = 1000;
const PROTOCOL_LINES = 5000;

export function createFakeConsole(emit: (event: AppEvent) => void, running: () => boolean) {
  let seq = 0;
  let open = 0;
  let nextQuery = 0;
  let nextAji = 0;
  let searched: string | null = null;
  const log: ConsoleLine[] = [];
  const protocol: ConsoleLine[] = [];

  function keep(kind: ConsoleKind, text: string, note?: ConsoleNote) {
    const isProtocol = kind === 'sent' || kind === 'received';
    if (isProtocol && open === 0) return;
    const line: ConsoleLine = { seq: ++seq, atMs: Date.now(), kind, text, ...(note && { note }) };
    const ring = isProtocol ? protocol : log;
    ring.push(line);
    if (ring.length > (isProtocol ? PROTOCOL_LINES : LOG_LINES)) ring.shift();
    emit({ type: 'engineConsoleLines', lines: [line] });
  }

  /** KataGo starting, as its stderr says it. */
  function started(katago: string, network: string) {
    searched = null;
    keep('aji', '', { kind: 'started', katago });
    keep('stderr', 'KataGo v1.18.2');
    keep('stderr', 'Using Metal backend');
    keep('stderr', `Loaded model ${network}`);
    keep('stderr', 'Started, ready to begin handling requests');
  }

  return {
    started,
    setOpen(value: boolean) {
      open = Math.max(0, open + (value ? 1 : -1));
    },
    linesAfter: (after: number) =>
      [...log, ...protocol].filter((l) => l.seq > after).sort((a, b) => a.seq - b.seq),
    /** The query Aji sent for a new position, then KataGo's report. */
    analysed(analysis: AnalysisUpdate) {
      // Closed, nothing is kept; on opening, the search shows from its query.
      if (open === 0) {
        searched = null;
        return;
      }
      if (analysis.position !== searched) {
        searched = analysis.position;
        nextAji += 1;
        keep(
          'sent',
          JSON.stringify({
            id: `aji-${nextAji}`,
            boardXSize: analysis.boardSize,
            boardYSize: analysis.boardSize,
            rules: 'chinese',
            komi: 7.5,
            maxVisits: 1_000_000,
            reportDuringSearchEvery: 0.1,
          }),
        );
      }
      keep(
        'received',
        JSON.stringify({
          id: `aji-${nextAji}`,
          isDuringSearch: !analysis.isFinal,
          rootInfo: {
            visits: analysis.rootVisits,
            winrate: analysis.winrate,
            scoreLead: analysis.scoreLead,
          },
          moveInfos: analysis.candidates.map((c) => ({ visits: c.visits, winrate: c.winrate })),
        }),
      );
    },
    /** A console query, checked as the engine checks it; the id its reply carries. */
    send(text: string): string {
      let query: unknown;
      try {
        query = JSON.parse(text);
      } catch {
        query = null;
      }
      const refuse = (detail: string) =>
        new TransportError('engineConsoleRefused', `refused: ${detail}`, detail);
      if (!query || typeof query !== 'object' || Array.isArray(query)) throw refuse('notJson');
      const q = query as Record<string, unknown>;
      if (typeof q.action !== 'string') throw refuse('search');
      if (q.action === 'terminate_all') throw refuse('terminateAll');
      if (
        q.action === 'terminate' &&
        !(typeof q.terminateId === 'string' && q.terminateId.startsWith('console-'))
      )
        throw refuse('terminateOther');
      if (!running()) throw new TransportError('engineNotRunning', 'KataGo is not running');
      // As the engine does: a typed id goes out behind `console-`.
      const id =
        typeof q.id !== 'string'
          ? `console-${++nextQuery}`
          : q.id.startsWith('console-')
            ? q.id
            : `console-${q.id}`;
      keep('sent', JSON.stringify({ ...q, id }));
      const reply =
        q.action === 'query_version'
          ? { id, action: q.action, version: '1.18.2', git_hash: 'fake' }
          : { id, action: q.action };
      keep('received', JSON.stringify(reply));
      return id;
    },
  };
}

export type FakeConsole = ReturnType<typeof createFakeConsole>;
