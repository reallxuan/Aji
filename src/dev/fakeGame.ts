import { sameRulesEffect } from '../game/komi';
import { noInfo } from '../game/testing';
import { utf8Base64 } from '../platform/fakeFiles';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { Candidate } from '../transport/generated/Candidate';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { GameInfo } from '../transport/generated/GameInfo';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { GameWarning } from '../transport/generated/GameWarning';
import type { Move } from '../transport/generated/Move';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { TransportError } from '../transport/transport';
import { createFakeTree } from './fakeTree';

/**
 * The scenario transport plays and exports editable fixtures. Opening a file selects a canned
 * game or failure by its name. The native backend parses the supplied SGF bytes.
 */

/** Samsung Cup 2025, final, game 2 (public domain, CWI Go games archive): 242 moves. */
const SAMSUNG =
  'pddddppqqoopccdccdcfcedebfcbbbbebdbgaecgqffqcnnckcickepeqdneoengiekggdgcfcfdfeedndmdodlcjchdgehehfgfffggidhcibfbighblglflemekflhmfnfkhkijgmheqfpjqlqhqfmhndmcmdlclckdnendkcjgifgjijjkjlijkijiiikkkimlpmpmokplokqkojpjoipnpmqoopgoqppnqpopnqnpmroqmqpfrgrerhrrnmkqoprilhljlhmhkpkrhpfqeqjqhpiiohprpqnhagbqoobpbqnphohqopaorqbrbrqsoqrqcgkhjfjfieiehdiqadbolmlegefhgbaabblbmakmreocqlrfheemmlbkbagafoknllmnknjoannnomnofognmplomlllnrkqiqloipjdhchrjsjrirmsmrllamakahoingnnbocmbmcnaqgrgmgsisqsplfglgm';

const SAMSUNG_INFO: GameInfo = {
  ...noInfo,
  black: '丁浩',
  blackRank: '九段',
  white: '廖元赫',
  whiteRank: '九段',
  result: 'W+R',
  date: '2025-11-17',
  event: '第30届三星杯决赛',
  round: '第2局',
};

interface Record {
  name: string | null;
  info: GameInfo;
  size: number;
  moves: Move[];
  fromFile: AnalysisRules;
  ru: string | null;
  km: string | null;
}

function moves(text: string) {
  return Array.from({ length: text.length / 2 }, (_, i) => ({
    type: 'play' as const,
    x: text.charCodeAt(2 * i) - 97,
    y: text.charCodeAt(2 * i + 1) - 97,
  }));
}

const samsung = (name: string): Record => ({
  name,
  info: SAMSUNG_INFO,
  size: 19,
  moves: moves(SAMSUNG),
  fromFile: { kind: 'japaneseKorean' },
  ru: null,
  km: '6.5',
});

/** What opening a file called `name` gives: a game and its warnings, or a failure. */
function openByName(name: string): { record: Record; warnings: GameWarning[] } {
  const stem = name.replace(/\.sgf$/i, '');
  if (name.includes('not-go')) throw new TransportError('sgfNotGo', 'GM[2]');
  if (name.includes('size')) throw new TransportError('sgfUnsupportedSize', '19x13', '19x13');
  if (name.includes('empty')) throw new TransportError('sgfNotAGame', 'no game');
  if (name.includes('truncated')) {
    const record = samsung(stem);
    record.moves = record.moves.slice(0, 183);
    return { record, warnings: [{ code: 'truncated' }] };
  }
  if (name.includes('gbk'))
    return {
      record: samsung(stem),
      warnings: [
        { code: 'encodingGuessed', encoding: 'GBK' },
        { code: 'extraGames', count: 2 },
      ],
    };
  if (name.includes('illegal'))
    return {
      record: {
        name: stem,
        info: { ...noInfo, gameName: '打劫练习' },
        size: 9,
        moves: moves('eeceeegcgg'),
        fromFile: { kind: 'chinese' },
        ru: 'Chinese',
        km: '7.5',
      },
      warnings: [{ code: 'illegalMoves' }],
    };
  return { record: samsung(stem), warnings: [] };
}

/** A small deterministic random source (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Six candidates: their share of the visits and the side to move's win-rate loss in points,
// so every tier of design 5.3 shows.
const SHARES = [0.42, 0.22, 0.14, 0.1, 0.07, 0.05];
const LOSSES = [0, 1.2, 2.8, 3.6, 6.5, 11];

/**
 * A made-up analysis of `snapshot` at `visits` root visits, for the development scenarios: six
 * candidates with lines on empty points, the same for the same position. The move played next is
 * among them, so the played-move ring shows. Black's view, as KataGo reports it.
 */
export function fakeAnalysis(
  snapshot: GameSnapshot,
  visits = 500,
  previousVisits = 0,
): AnalysisUpdate {
  const position = snapshot.positionKey ?? '0000000000000000';
  const next = random(parseInt(position.slice(-8), 16) * 2654435761);
  const { size, stones } = snapshot;
  const taken = new Set(stones.flatMap((stone, i) => (stone ? [i] : [])));
  const pick = (used: Set<number>): Move | null => {
    if (used.size >= size * size) return null;
    for (;;) {
      const i = Math.floor(next() * size * size);
      if (!used.has(i)) {
        used.add(i);
        return { type: 'play', x: i % size, y: Math.floor(i / size) };
      }
    }
  };
  const where = (m: Move) => (m.type === 'play' ? m.y * size + m.x : -1);

  // The win rate wanders over the game, so the trend graph has a shape.
  const winrate =
    0.5 + 0.38 * Math.sin(snapshot.moveNumber / 23) * Math.cos(snapshot.moveNumber / 61);
  // Not proportional to the win rate, so the graph's two lines do not lie on top of each other.
  const scoreLead = (winrate - 0.5) * 28 + 2.5 * Math.sin(snapshot.moveNumber / 7);
  const sign = snapshot.nextColor === 'black' ? 1 : -1;

  const played =
    snapshot.nextMove?.type === 'play' && !taken.has(where(snapshot.nextMove))
      ? snapshot.nextMove
      : null;
  const firsts = new Set(taken);
  if (played) firsts.add(where(played));
  const moves: Move[] = [];
  for (let i = 0; i < SHARES.length; i++) {
    const move = i === 2 && played ? played : pick(firsts);
    if (!move) break;
    moves.push(move);
  }
  const candidates: Candidate[] = moves.map((move, order) => {
    const used = new Set(taken);
    used.add(where(move));
    const pv: Move[] = [move];
    const length = 6 + Math.floor(next() * 18);
    while (pv.length < length) {
      const m = pick(used);
      if (!m) break;
      pv.push(m);
    }
    const loss = LOSSES[order];
    return {
      move,
      order,
      visits: Math.round(SHARES[order] * visits),
      winrate: Math.min(1, Math.max(0, winrate - (sign * loss) / 100)),
      scoreLead: scoreLead - sign * loss * 0.35,
      prior: SHARES[order] * 0.9,
      pv,
    };
  });
  return {
    position,
    boardSize: size,
    rootVisits: visits,
    winrate,
    scoreLead,
    isFinal: false,
    candidates,
    previousVisits,
    ownership: null,
    next: null,
  };
}

export function createFakeGame(emit: (event: AppEvent) => void) {
  let session = createFakeTree(19, []);
  let warnings: GameWarning[] = [];

  function response(includeWarnings = false): Response {
    return {
      type: 'game',
      snapshot: session.snapshot(),
      warnings: includeWarnings ? warnings : [],
    };
  }
  function publish(before: GameSnapshot, opened = false): Response {
    const next = session.snapshot();
    if (next.revision !== before.revision) emit({ type: 'gameSnapshot', snapshot: next });
    if (next.treeRevision !== before.treeRevision) emit({ type: 'gameTree', tree: session.tree() });
    if (next.lineRevision !== before.lineRevision)
      emit({
        type: 'gameTrend',
        reason:
          opened || !sameRulesEffect(before.rules.current, next.rules.current)
            ? 'reset'
            : 'lineChanged',
        revision: next.lineRevision,
        nodes: session.line(),
      });
    return { type: 'game', snapshot: next, warnings: opened ? warnings : [] };
  }
  function load(record: Record, found: GameWarning[], atEnd = false): Response {
    const before = session.snapshot();
    session = createFakeTree(record.size, record.moves, {
      ...record,
      revision: before.revision + 1,
      treeRevision: before.treeRevision + 1,
      lineRevision: before.lineRevision + 1,
      saveAsFirst: found.some((w) => w.code === 'truncated' || w.code === 'repaired'),
    });
    if (atEnd) session.navigate('last');
    warnings = found;
    return publish(before, true);
  }

  function handle(request: Request): Response | null {
    switch (request.type) {
      case 'gameNew': {
        if (!Number.isInteger(request.size) || request.size < 5 || request.size > 19) {
          const size = request.size + 'x' + request.size;
          throw new TransportError('sgfUnsupportedSize', size, size);
        }
        return load(
          {
            size: request.size,
            moves: [],
            info: noInfo,
            name: null,
            fromFile: { kind: 'chinese' },
            ru: null,
            km: null,
          },
          [],
        );
      }
      case 'gameOpen': {
        const opened = openByName(request.name);
        return load(opened.record, opened.warnings, request.atEnd);
      }
      case 'gameSnapshot':
        return response(true);
      case 'gameTree':
        return { type: 'gameTree', ...session.tree() };
      case 'gameTrend':
        return { type: 'trend', revision: session.snapshot().lineRevision, nodes: session.line() };
      case 'gamePreview':
        return { type: 'gamePreview', preview: session.preview(request.moves) };
      case 'gameExport': {
        const text = session.exportText(request.options);
        return {
          type: 'gameExport',
          name: (session.snapshot().name ?? 'game') + '.sgf',
          editId: session.editId(),
          text: request.options.inPlace ? null : text,
          bytes: request.options.inPlace ? utf8Base64(text) : null,
          fellBack: false,
        };
      }
      case 'gameNavigate':
      case 'gameEdit':
      case 'gameUndo':
      case 'gameRedo':
      case 'gameSaved': {
        const before = session.snapshot();
        switch (request.type) {
          case 'gameNavigate':
            session.navigate(request.to);
            break;
          case 'gameEdit':
            session.edit(request.edit);
            break;
          case 'gameUndo':
            session.undo();
            break;
          case 'gameRedo':
            session.redo();
            break;
          case 'gameSaved':
            session.saved(request.editId);
            break;
        }
        return publish(before);
      }
      default:
        return null;
    }
  }
  return Object.assign(handle, {
    mainLine: () => session.mainLine(),
    onMainLine: () => session.onMainLine(),
  });
}

/** Sample files the scenarios' open dialog, drops and recent list offer. */
export const SAMPLE_FILES = {
  files: {
    '/样例/samsung-30-final-2.sgf': '(;)',
    '/样例/野狐-gbk.sgf': '(;)',
    '/样例/truncated.sgf': '(;)',
    '/样例/illegal-ko.sgf': '(;)',
    '/样例/size-19x13.sgf': '(;)',
  },
  pick: '/样例/samsung-30-final-2.sgf',
  recent: [
    '/样例/samsung-30-final-2.sgf',
    '/样例/野狐-gbk.sgf',
    '/样例/moved-away.sgf',
    '/样例/illegal-ko.sgf',
    '/样例/size-19x13.sgf',
  ],
};
