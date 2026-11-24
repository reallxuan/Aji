import { sameRulesEffect } from '../game/komi';
import { makeSnapshot, noInfo } from '../game/testing';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { Candidate } from '../transport/generated/Candidate';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { Color } from '../transport/generated/Color';
import type { GameInfo } from '../transport/generated/GameInfo';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { GameTree } from '../transport/generated/GameTree';
import type { GameWarning } from '../transport/generated/GameWarning';
import type { Illegal } from '../transport/generated/Illegal';
import type { Move } from '../transport/generated/Move';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import type { TrendNode } from '../transport/generated/TrendNode';
import { TransportError } from '../transport/transport';

/**
 * A stand-in for the backend's game session, for the development scenarios: it plays a game's
 * moves with captures and answers the `game*` requests. It knows nothing of SGF; "opening" a file
 * picks a canned game, or a canned failure, by the file's name.
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
  moves: Array<{ x: number; y: number }>;
  fromFile: AnalysisRules;
  ru: string | null;
  km: string | null;
}

interface Node {
  stones: (Color | null)[];
  lastMove: Move | null;
  illegal: Illegal | null;
  captures: [number, number];
}

function moves(text: string) {
  return Array.from({ length: text.length / 2 }, (_, i) => ({
    x: text.charCodeAt(2 * i) - 97,
    y: text.charCodeAt(2 * i + 1) - 97,
  }));
}

/** The board after each move, with captures; an occupied point is flagged, as the backend does. */
function play(record: Record): Node[] {
  const n = record.size;
  const nodes: Node[] = [
    { stones: Array(n * n).fill(null), lastMove: null, illegal: null, captures: [0, 0] },
  ];
  const near = (i: number) =>
    [i - n, i + n, i % n ? i - 1 : -1, (i + 1) % n ? i + 1 : -1].filter((j) => j >= 0 && j < n * n);
  record.moves.forEach(({ x, y }, k) => {
    const prev = nodes[nodes.length - 1];
    const stones = [...prev.stones];
    const captures: [number, number] = [...prev.captures];
    const color: Color = k % 2 ? 'white' : 'black';
    const at = y * n + x;
    const illegal: Illegal | null = stones[at] ? 'occupied' : null;
    stones[at] = color;
    for (const start of near(at)) {
      if (stones[start] !== (color === 'black' ? 'white' : 'black')) continue;
      const group = [start];
      const seen = new Set(group);
      let free = false;
      for (let g = 0; g < group.length; g++)
        for (const j of near(group[g])) {
          if (stones[j] === null) free = true;
          else if (stones[j] === stones[start] && !seen.has(j)) {
            seen.add(j);
            group.push(j);
          }
        }
      if (free) continue;
      for (const j of group) stones[j] = null;
      captures[color === 'black' ? 0 : 1] += group.length;
    }
    nodes.push({ stones, lastMove: { type: 'play', x, y }, illegal, captures });
  });
  return nodes;
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
    0.5 + 0.38 * Math.sin(snapshot.lineIndex / 23) * Math.cos(snapshot.lineIndex / 61);
  // Not proportional to the win rate, so the graph's two lines do not lie on top of each other.
  const scoreLead = (winrate - 0.5) * 28 + 2.5 * Math.sin(snapshot.lineIndex / 7);
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
  let record: Record = {
    name: null,
    info: noInfo,
    size: 19,
    moves: [],
    fromFile: { kind: 'chinese' },
    ru: null,
    km: null,
  };
  let nodes = play(record);
  let index = 0;
  let rules: AnalysisRules = record.fromFile;
  let revision = 0;
  let warnings: GameWarning[] = [];
  let lineRevision = 0;
  let treeRevision = 0;
  let saveAsFirst = false;
  // The linear scenario supports rules edits. Preserve their identity when redo is discarded.
  const history: { id: number; before: AnalysisRules; after: AnalysisRules }[] = [];
  let applied = 0;
  let nextId = 0;
  let savedId = 0;
  const editId = () => history[applied - 1]?.id ?? 0;

  function tree(): GameTree {
    return {
      revision: treeRevision,
      nodes: nodes.map((node, id) => ({
        id,
        parent: id ? id - 1 : null,
        color: id === 0 ? null : id % 2 ? 'black' : 'white',
        mv: node.lastMove,
        flags: (node.lastMove ? 0 : 4) | (node.illegal ? 8 : 0),
      })),
    };
  }

  function placed(): GameSnapshot['placed'] {
    const stones = nodes[index].stones.slice();
    const result: GameSnapshot['placed'] = [];
    for (let i = index; i > 0; i--) {
      const move = nodes[i].lastMove;
      if (move?.type !== 'play') continue;
      const at = move.y * record.size + move.x;
      if (stones[at] !== (i % 2 ? 'black' : 'white')) continue;
      result.push({ point: { x: move.x, y: move.y }, node: i, number: i, branchNumber: null });
      stones[at] = null;
    }
    return result.reverse();
  }

  function positionKey(i: number) {
    return nodes[i].illegal ? null : (0x1000 + i).toString(16).padStart(16, '0');
  }

  function snapshot(): GameSnapshot {
    const node = nodes[index];
    const last = nodes.length - 1;
    return makeSnapshot({
      revision,
      node: index,
      lineRevision,
      treeRevision,
      continuations:
        index < last ? [{ node: index + 1, mv: nodes[index + 1].lastMove, tryout: false }] : [],
      saveAsFirst,
      placed: placed(),
      changed: savedId !== editId(),
      canUndo: applied > 0,
      canRedo: applied < history.length,
      name: record.name,
      info: record.info,
      rules: {
        current: rules,
        fromFile: record.fromFile,
        changed: !sameRulesEffect(rules, record.fromFile),
        ru: record.ru,
        km: record.km,
      },
      size: record.size,
      stones: node.stones,
      lastMove: node.lastMove,
      nextColor: index % 2 ? 'white' : 'black',
      moveNumber: index,
      lineIndex: index,
      nextMove: index < last ? nodes[index + 1].lastMove : null,
      lineLength: last,
      atStart: index === 0,
      atEnd: index === last,
      illegal: node.illegal,
      captures: node.captures,
      positionKey: positionKey(index),
      hasMoves: last > 0,
    });
  }

  /** One node per main-line node; the backend fills in its cached stats, the fake has none. */
  function trend(): TrendNode[] {
    return nodes.map((node, i) => ({
      node: i,
      key: positionKey(i),
      moveNumber: i,
      tryout: false,
      toPlay: i % 2 ? 'white' : 'black',
      mover: i === 0 ? null : i % 2 ? 'black' : 'white',
      move: node.lastMove,
      stats: null,
      loss: null,
    }));
  }

  function changed(withWarnings = false, withTrend = false, withTree = false): Response {
    revision += 1;
    if (withTrend) lineRevision++;
    if (withTree) treeRevision++;
    const next = snapshot();
    emit({ type: 'gameSnapshot', snapshot: next });
    if (withTree) emit({ type: 'gameTree', tree: tree() });
    if (withTrend)
      emit({ type: 'gameTrend', reason: 'reset', revision: lineRevision, nodes: trend() });
    return { type: 'game', snapshot: next, warnings: withWarnings ? warnings : [] };
  }

  function load(next: Record, nextWarnings: GameWarning[], atEnd = false): Response {
    record = next;
    nodes = play(record);
    index = atEnd ? nodes.length - 1 : 0;
    history.length = 0;
    applied = 0;
    nextId = 0;
    savedId = 0;
    saveAsFirst = nextWarnings.some((w) => w.code === 'truncated' || w.code === 'repaired');
    rules = record.fromFile;
    warnings = nextWarnings;
    return changed(true, true, true);
  }

  /** The answer to a `game*` request, or `null` for any other request. */
  return function handle(request: Request): Response | null {
    switch (request.type) {
      case 'gameSnapshot':
        return { type: 'game', snapshot: snapshot(), warnings };
      case 'gameNew':
        if (request.size < 5 || request.size > 19) {
          const size = `${request.size}x${request.size}`;
          throw new TransportError('sgfUnsupportedSize', size, size);
        }
        return load(
          {
            name: null,
            info: noInfo,
            size: request.size,
            moves: [],
            fromFile: { kind: 'chinese' },
            ru: null,
            km: null,
          },
          [],
        );
      case 'gameOpen': {
        const { record: next, warnings: found } = openByName(request.name);
        return load(next, found, request.atEnd);
      }
      case 'gameNavigate': {
        const last = nodes.length - 1;
        const to = request.to;
        let target = index;
        if (typeof to === 'object') {
          if ('move' in to) target = Math.min(last, to.move);
          else if (to.node >= 0 && to.node <= last) target = to.node;
        } else {
          switch (to) {
            case 'first':
              target = 0;
              break;
            case 'last':
              target = last;
              break;
            case 'previous':
              target = Math.max(0, index - 1);
              break;
            case 'next':
              target = Math.min(last, index + 1);
              break;
          }
        }
        if (target === index) return { type: 'game', snapshot: snapshot(), warnings: [] };
        index = target;
        return changed();
      }
      case 'gameTree':
        return { type: 'gameTree', ...tree() };
      case 'gameEdit': {
        if (request.edit.kind !== 'setRules') return null;
        const next = request.edit.rules ?? record.fromFile;
        if (JSON.stringify(next) === JSON.stringify(rules))
          return { type: 'game', snapshot: snapshot(), warnings: [] };
        const effectChanged = !sameRulesEffect(rules, next);
        if (effectChanged) {
          history.splice(applied, history.length - applied, {
            id: ++nextId,
            before: rules,
            after: next,
          });
          applied++;
        }
        rules = next;
        return changed(false, effectChanged);
      }
      case 'gameUndo':
        if (applied === 0) return { type: 'game', snapshot: snapshot(), warnings: [] };
        rules = history[--applied].before;
        return changed(false, true);
      case 'gameRedo':
        if (applied === history.length) return { type: 'game', snapshot: snapshot(), warnings: [] };
        rules = history[applied++].after;
        return changed(false, true);
      case 'gameSaved': {
        const wasChanged = editId() !== savedId;
        const wasSaveAsFirst = saveAsFirst;
        saveAsFirst = false;
        savedId = request.editId;
        return wasSaveAsFirst || wasChanged !== (savedId !== editId())
          ? changed()
          : { type: 'game', snapshot: snapshot(), warnings: [] };
      }
      case 'gamePreview':
        return {
          type: 'gamePreview',
          preview: { stones: nodes[index].stones, captured: [], illegalAt: null },
        };
      case 'gameTrend':
        return { type: 'trend', revision: lineRevision, nodes: trend() };
      case 'gameExport': {
        if (nodes.length === 1) throw new TransportError('gameEmpty', 'nothing to save');
        const text = '(;GM[1]FF[4]CA[UTF-8])\n';
        return {
          type: 'gameExport',
          name: `${record.name ?? 'game'}.sgf`,
          text: request.options.inPlace ? null : text,
          bytes: request.options.inPlace ? btoa(text) : null,
          editId: editId(),
          fellBack: false,
        };
      }
      default:
        return null;
    }
  };
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
