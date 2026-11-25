import { komiOf, parseKomi, sameRulesEffect, scoringOf } from '../game/komi';
import { noInfo } from '../game/testing';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { Color } from '../transport/generated/Color';
import type { ExportOptions } from '../transport/generated/ExportOptions';
import type { GameInfo } from '../transport/generated/GameInfo';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { GameTree } from '../transport/generated/GameTree';
import type { Illegal } from '../transport/generated/Illegal';
import type { MarkAt } from '../transport/generated/MarkAt';
import type { Move } from '../transport/generated/Move';
import type { NavTarget } from '../transport/generated/NavTarget';
import type { Point } from '../transport/generated/Point';
import type { Preview } from '../transport/generated/Preview';
import type { SessionEdit } from '../transport/generated/SessionEdit';
import type { TrendNode } from '../transport/generated/TrendNode';
import { TransportError } from '../transport/transport';

interface Node {
  id: number;
  parent: number | null;
  children: number[];
  color: Color | null;
  mv: Move | null;
  tryout: boolean;
  comment: string | null;
  marks: MarkAt[];
  setup: Record<number, Color | null>;
  pl: Color | null;
}

const newNode = (
  id: number,
  parent: number | null,
  color: Color | null,
  mv: Move | null,
): Node => ({
  id,
  parent,
  color,
  mv,
  children: [],
  tryout: false,
  comment: null,
  marks: [],
  setup: {},
  pl: null,
});
const other = (c: Color): Color => (c === 'black' ? 'white' : 'black');
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const sameMove = (a: Move | null, b: Move) =>
  a?.type === 'play' && b.type === 'play' ? samePoint(a, b) : a?.type === b.type;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const noNode = () => new TransportError('gameNoSuchNode', 'no such node');

interface Board {
  stones: (Color | null)[];
  captures: [number, number];
  ko: { at: number; color: Color } | null;
  illegal: Illegal | null;
}
const onBoard = (p: Point, size: number) =>
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  p.x >= 0 &&
  p.y >= 0 &&
  p.x < size &&
  p.y < size;

function applyMove(board: Board, size: number, color: Color, mv: Move): number[] {
  const ko = board.ko;
  board.illegal = null;
  board.ko = null;
  if (mv.type === 'pass') return [];
  if (!onBoard(mv, size)) {
    board.illegal = 'offBoard';
    return [];
  }
  const { stones, captures } = board;
  const at = mv.y * size + mv.x;
  const near = (i: number) =>
    [i - size, i + size, i % size ? i - 1 : -1, (i + 1) % size ? i + 1 : -1].filter(
      (j) => j >= 0 && j < stones.length,
    );
  const group = (start: number) => {
    const points = new Set([start]);
    const liberties = new Set<number>();
    for (const i of points)
      for (const j of near(i)) {
        if (stones[j] === null) liberties.add(j);
        else if (stones[j] === stones[start]) points.add(j);
      }
    return { points, liberties };
  };
  board.illegal = stones[at] ? 'occupied' : ko?.at === at && ko.color === color ? 'ko' : null;
  stones[at] = color;
  const removed: number[] = [];
  for (const j of near(at)) {
    if (stones[j] !== other(color)) continue;
    const enemy = group(j);
    if (enemy.liberties.size) continue;
    for (const p of enemy.points) {
      removed.push(p);
      stones[p] = null;
    }
  }
  captures[color === 'black' ? 0 : 1] += removed.length;
  const own = group(at);
  if (!own.liberties.size && !board.illegal) {
    // A suicide cannot capture. Undo its placement and leave the original group on the board.
    stones[at] = null;
    board.illegal = 'suicide';
  } else if (own.points.size === 1 && own.liberties.size === 1 && removed.length === 1) {
    board.ko = { at: removed[0], color: other(color) };
  }
  return removed;
}

function ruleName(rules: AnalysisRules): string {
  const scoring = scoringOf(rules);
  if (
    rules.kind !== 'custom' ||
    !rules.details ||
    sameRulesEffect(rules, { ...rules, details: null })
  )
    return scoring === 'area' ? 'Chinese' : 'Japanese';
  const d = rules.details;
  let name =
    'ko' +
    d.ko.toUpperCase() +
    'score' +
    scoring.toUpperCase() +
    'tax' +
    d.tax.toUpperCase() +
    'sui' +
    Number(d.suicide);
  if (d.hasButton) name += 'button1';
  if (d.whiteHandicapBonus !== 'zero') name += 'whb' + (d.whiteHandicapBonus === 'n' ? 'N' : 'N-1');
  if (d.friendlyPassOk) name += 'fpok1';
  return name;
}

interface State {
  nodes: Record<number, Node>;
  current: number;
  tip: number;
  tryout: number | null;
  info: GameInfo;
  rules: AnalysisRules;
  editId: number;
}
type Source = Partial<
  Pick<GameSnapshot, 'name' | 'saveAsFirst' | 'info' | 'revision' | 'lineRevision' | 'treeRevision'>
> & { fromFile?: AnalysisRules; ru?: string | null; km?: string | null };
interface Position extends Board {
  number: number;
  next: Color;
  key: string;
}

export function createFakeTree(size: number, moves: Move[], source: Source = {}) {
  const fromFile = source.fromFile ?? { kind: 'chinese' };
  let state: State = {
    nodes: { 0: newNode(0, null, null, null) },
    current: 0,
    tip: 0,
    tryout: null,
    rules: fromFile,
    info: source.info ?? noInfo,
    editId: 0,
  };
  let nextNode = 1;
  let nextEdit = 1;
  let savedId = 0;
  let saveAsFirst = source.saveAsFirst ?? false;
  let revision = source.revision ?? 0;
  let lineRevision = source.lineRevision ?? 0;
  let treeRevision = source.treeRevision ?? 0;
  const history: { before: State; after: State }[] = [];
  let applied = 0;
  const get = (id: number) => state.nodes[id];
  const here = () => get(state.current);
  const append = (parent: number, color: Color | null, mv: Move | null) => {
    const n = newNode(nextNode++, parent, color, mv);
    get(parent).children.push(n.id);
    state.nodes[n.id] = n;
    n.tryout = state.tryout !== null;
    return n;
  };
  moves.forEach((mv, i) => append(i, i % 2 ? 'white' : 'black', mv));

  const path = (id: number) => {
    const ids: number[] = [];
    for (let n: number | null = id; n !== null; n = get(n).parent) ids.push(n);
    return ids.reverse();
  };
  const selected = (tip = state.tip) => {
    const ids = path(tip);
    for (let n = get(tip); n.children.length;) {
      n = get(n.children[0]);
      ids.push(n.id);
    }
    return ids;
  };
  const preorder = (root = 0) => {
    const ids: number[] = [];
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      ids.push(id);
      stack.push(...[...get(id).children].reverse());
    }
    return ids;
  };
  // Small fixtures keep derived boards outside undo history. Interning the replay path keeps
  // keys stable across metadata edits, navigation and undo, including on a dormant variation.
  const positions = new Map<number, Position>();
  const keys = new Map<string, string>();
  const ruleEffects: AnalysisRules[] = [];
  const point = (i: number) => ({ x: i % size, y: Math.floor(i / size) });
  const index = (p: Point) => p.y * size + p.x;
  function position(id: number): Position {
    const cached = positions.get(id);
    if (cached) return cached;
    const n = get(id);
    const parent = n.parent === null ? null : position(n.parent);
    const board: Position = {
      stones: parent?.stones.slice() ?? Array(size * size).fill(null),
      captures: parent ? [...parent.captures] : [0, 0],
      ko: parent?.ko ?? null,
      illegal: null,
      number: (parent?.number ?? 0) + Number(n.mv !== null),
      next: n.pl ?? (n.color ? other(n.color) : (parent?.next ?? 'black')),
      key: '',
    };
    for (const [i, c] of Object.entries(n.setup)) {
      board.stones[Number(i)] = c;
      board.ko = null;
    }
    if (n.mv && n.color) applyMove(board, size, n.color, n.mv);
    let effect = ruleEffects.findIndex((r) => sameRulesEffect(r, state.rules));
    if (effect < 0) effect = ruleEffects.push(state.rules) - 1;
    if (parent && !n.mv && !n.pl && !Object.keys(n.setup).length) {
      board.key = parent.key;
    } else {
      const signature = JSON.stringify([effect, parent?.key, n.color, n.mv, n.setup, n.pl]);
      if (!keys.has(signature))
        keys.set(signature, (0x1000 + keys.size).toString(16).padStart(16, '0'));
      board.key = keys.get(signature)!;
    }
    positions.set(id, board);
    return board;
  }
  function line(tip = state.tip): TrendNode[] {
    return selected(tip).map((id) => {
      const n = get(id),
        p = position(id);
      return {
        node: id,
        key: p.illegal ? null : p.key,
        moveNumber: p.number,
        tryout: n.tryout,
        toPlay: p.illegal ? null : p.next,
        mover: n.color,
        move: n.mv,
        stats: null,
        loss: null,
      };
    });
  }
  function tree(): GameTree {
    return {
      revision: treeRevision,
      nodes: preorder().map((id) => {
        const n = get(id);
        return {
          id,
          parent: n.parent,
          color: n.color,
          mv: n.mv,
          flags:
            Number(!!n.comment) |
            (n.tryout ? 2 : 0) |
            (n.mv ? 0 : 4) |
            (position(id).illegal ? 8 : 0),
        };
      }),
    };
  }
  function variation(id: number) {
    return path(id)
      .reverse()
      .find((child) => {
        const parent = get(child).parent;
        return parent !== null && get(parent).children[0] !== child;
      });
  }
  function nextMove(ids: number[], slot: number): Move | null {
    const before = position(ids[slot]).stones;
    for (const id of ids.slice(slot + 1)) {
      const n = get(id);
      if (n.mv) return n.mv;
      if (Object.keys(n.setup).length && !same(before, position(id).stones)) return null;
    }
    return null;
  }
  function snapshot(): GameSnapshot {
    const n = here(),
      p = position(n.id),
      ids = selected(),
      slot = ids.indexOf(n.id);
    const pending = [...p.stones],
      placed: GameSnapshot['placed'] = [];
    const branch = variation(n.id);
    const base = branch === undefined ? Infinity : position(get(branch).parent!).number;
    for (const id of path(n.id).reverse()) {
      const ancestor = get(id);
      if (ancestor.mv?.type === 'play') {
        const i = index(ancestor.mv),
          number = position(id).number;
        if (pending[i] === ancestor.color && position(id).illegal !== 'suicide') {
          placed.push({
            point: point(i),
            node: id,
            number,
            branchNumber: number > base ? number - base : null,
          });
          pending[i] = null;
        }
      }
      for (const i of Object.keys(ancestor.setup)) pending[Number(i)] = null;
    }
    return {
      revision,
      gameRevision: source.revision ?? 0,
      lineRevision,
      treeRevision,
      node: n.id,
      tryout: state.tryout,
      comment: n.comment,
      marks: n.marks,
      continuations: n.children.map((id) => ({ node: id, mv: get(id).mv, tryout: get(id).tryout })),
      changed: state.editId !== savedId,
      canUndo: applied > 0,
      canRedo: applied < history.length,
      saveAsFirst,
      placed: placed.reverse(),
      name: source.name ?? null,
      info: state.info,
      rules: {
        current: state.rules,
        fromFile,
        changed: !sameRulesEffect(state.rules, fromFile),
        ru: source.ru ?? null,
        km: source.km ?? null,
      },
      size,
      stones: p.stones,
      lastMove: n.mv,
      nextColor: p.next,
      moveNumber: p.number,
      lineIndex: slot,
      nextMove: nextMove(ids, slot),
      lineLength: position(ids.at(-1)!).number,
      atStart: slot === 0,
      atEnd: slot === ids.length - 1,
      illegal: p.illegal,
      captures: p.captures,
      positionKey: p.illegal ? null : p.key,
      hasMoves: Object.values(state.nodes).some(
        (n) => !n.tryout && (n.mv || Object.keys(n.setup).length),
      ),
    };
  }
  function navigate(to: NavTarget) {
    const ids = selected(),
      at = ids.indexOf(state.current);
    const n = here();
    let target = n.id;
    if (typeof to === 'object') {
      if ('node' in to) target = get(to.node)?.id ?? n.id;
      else target = to.move <= 0 ? 0 : (ids.filter((id) => get(id).mv)[to.move - 1] ?? ids.at(-1)!);
    } else
      switch (to) {
        case 'first':
          target = 0;
          break;
        case 'last':
          target = ids.at(-1)!;
          break;
        case 'previous':
          target = ids[at - 1] ?? n.id;
          break;
        case 'next':
          target = ids[at + 1] ?? n.id;
          break;
        case 'nextSibling':
        case 'previousSibling': {
          if (n.parent !== null) {
            const siblings = get(n.parent).children;
            target = siblings[siblings.indexOf(n.id) + (to === 'nextSibling' ? 1 : -1)] ?? n.id;
          }
          break;
        }
        case 'branchPoint': {
          const child = variation(n.id);
          if (child !== undefined) target = get(child).parent!;
          break;
        }
        case 'mainLine': {
          const main = selected(0);
          target = path(n.id)
            .reverse()
            .find((id) => main.includes(id))!;
          break;
        }
      }
    const tip = to === 'mainLine' || !ids.includes(target) ? target : state.tip;
    const lineChanged = !same(ids, selected(tip));
    if (target !== state.current || lineChanged) {
      state = { ...state, current: target, tip };
      revision++;
      if (lineChanged) lineRevision++;
    }
  }
  function remove(id: number) {
    const parent = get(id).parent;
    if (parent === null) return;
    const oldLine = selected(),
      oldPath = path(state.current);
    get(parent).children = get(parent).children.filter((c) => c !== id);
    for (const child of preorder(id)) delete state.nodes[child];
    if (!get(state.current)) state.current = oldPath.reverse().find((i) => get(i))!;
    if (!get(state.tip)) state.tip = oldLine.reverse().find((i) => get(i))!;
  }
  const checkPoint = (p: Point) => {
    if (!onBoard(p, size)) throw new TransportError('gameIllegalMove', 'offBoard', 'offBoard');
  };
  const focus = (id: number) => {
    state.current = id;
    state.tip = id;
  };
  function mutate(e: SessionEdit) {
    const n = here();
    const target = 'node' in e ? get(e.node) : n;
    if (!target) throw noNode();
    if (
      state.tryout !== null &&
      !(
        e.kind === 'play' ||
        e.kind === 'pass' ||
        e.kind === 'tryoutEnd' ||
        (e.kind === 'moveLastMove' && n.tryout) ||
        (['setComment', 'deleteFrom', 'tryoutKeep'].includes(e.kind) && target.tryout)
      )
    )
      throw new TransportError('gameEndTryoutFirst', 'end try-out first');
    switch (e.kind) {
      case 'pass':
      case 'play': {
        const mv: Move = e.kind === 'pass' ? { type: 'pass' } : e.mv;
        const p = position(n.id);
        const existing = n.children.find(
          (id) => get(id).color === p.next && sameMove(get(id).mv, mv),
        );
        if (existing !== undefined) {
          focus(existing);
          return;
        }
        const board = structuredClone(p);
        applyMove(board, size, p.next, mv);
        if (board.illegal)
          throw new TransportError('gameIllegalMove', board.illegal, board.illegal);
        focus(append(n.id, p.next, mv).id);
        return;
      }
      case 'tryoutStart':
        state.tryout = n.id;
        return;
      case 'tryoutEnd': {
        if (state.tryout === null) return;
        for (const id of preorder()) if (get(id)?.tryout) remove(id);
        state.current = state.tryout;
        if (!selected().includes(state.current)) state.tip = state.current;
        state.tryout = null;
        return;
      }
      case 'tryoutKeep':
        if (!target.tryout) throw noNode();
        for (const id of [...path(target.id), ...preorder(target.id)]) get(id).tryout = false;
        if (!Object.values(state.nodes).some((n) => n.tryout)) state.tryout = null;
        return;
      case 'deleteFrom':
        remove(target.id);
        return;
      case 'deleteBranch':
      case 'promote':
      case 'moveUp': {
        const child = variation(target.id);
        if (child === undefined) throw noNode();
        if (e.kind === 'deleteBranch') {
          remove(child);
          return;
        }
        for (const id of e.kind === 'promote' ? path(child).slice(1) : [child]) {
          const siblings = get(get(id).parent!).children,
            at = siblings.indexOf(id);
          siblings.splice(at, 1);
          siblings.splice(e.kind === 'promote' ? 0 : at - 1, 0, id);
        }
        if (!selected().includes(n.id)) state.tip = n.id;
        return;
      }
      case 'setComment':
        target.comment = e.text || null;
        return;
      case 'setInfo':
        state.info[e.field] = e.value?.trim() || null;
        return;
      case 'setRules':
        if (e.rules?.kind === 'custom' && parseKomi(String(e.rules.komi)) === null)
          throw new TransportError('internal', 'invalid komi');
        state.rules = e.rules ?? fromFile;
        return;
      case 'clearMarks':
        target.marks = [];
        return;
      case 'setMark': {
        checkPoint(e.point);
        const old = target.marks.find((m) => samePoint(m.point, e.point));
        if (same(old?.mark ?? null, e.mark)) return;
        target.marks = target.marks.filter((m) => !samePoint(m.point, e.point));
        if (e.mark) target.marks.push({ point: e.point, mark: e.mark });
        return;
      }
      case 'setToPlay':
      case 'setupStone':
      case 'moveStone': {
        const p = position(n.id);
        if (e.kind === 'setupStone') checkPoint(e.point);
        if (e.kind === 'moveStone') {
          checkPoint(e.from);
          checkPoint(e.to);
          if (samePoint(e.from, e.to) || !p.stones[index(e.from)]) return;
        }
        const setup = n.mv ? append(n.id, null, null) : n;
        if (setup !== n) focus(setup.id);
        if (e.kind === 'setToPlay') setup.pl = e.color;
        else if (e.kind === 'moveStone') {
          setup.setup[index(e.from)] = null;
          setup.setup[index(e.to)] = p.stones[index(e.from)];
        } else {
          const at = index(e.point);
          if (
            e.stone !== null ||
            (setup.parent !== null && position(setup.parent).stones[at] !== null)
          )
            setup.setup[at] = e.stone;
          else delete setup.setup[at];
        }
        return;
      }
      case 'moveLastMove': {
        checkPoint(e.to);
        if (n.mv?.type !== 'play' || !n.color || n.parent === null) throw noNode();
        if (samePoint(n.mv, e.to)) return;
        const mv: Move = { type: 'play', ...e.to };
        const board = structuredClone(position(n.parent));
        applyMove(board, size, n.color, mv);
        if (board.illegal)
          throw new TransportError('gameIllegalMove', board.illegal, board.illegal);
        // Later nodes, in every branch, that are legal now and would not be after the move.
        const later = preorder(n.id).slice(1);
        const illegal = () => new Set(later.filter((id) => position(id).illegal));
        const before = illegal();
        n.mv = mv;
        positions.clear();
        const count = [...illegal()].filter((id) => !before.has(id)).length;
        positions.clear();
        if (count && !e.allowIllegal)
          throw new TransportError(
            'gameLaterMovesIllegal',
            `${count} later moves would become illegal`,
            String(count),
          );
        return;
      }
      case 'insertMove':
      case 'flatten':
        throw new TransportError('internal', e.kind + ' requires the native backend');
    }
  }

  function restore(next: State) {
    const oldTree = tree().nodes,
      oldLine = line();
    state = next;
    positions.clear();
    if (!same(oldTree, tree().nodes)) treeRevision++;
    if (!same(oldLine, line())) lineRevision++;
    revision++;
  }
  function edit(e: SessionEdit) {
    const before = state;
    state = structuredClone(before);
    let after: State;
    try {
      mutate(e);
      after = state;
    } finally {
      state = before;
    }
    if (same(before, after)) return;
    const recordChanged =
      !same(before.nodes, after.nodes) ||
      !same(before.info, after.info) ||
      !sameRulesEffect(before.rules, after.rules);
    if (recordChanged || before.tryout !== after.tryout) {
      if ((before.tryout === null && recordChanged) || e.kind === 'tryoutKeep')
        after.editId = nextEdit++;
      history.splice(applied);
      history.push({ before, after });
      if (history.length > 1000) history.shift();
      applied = history.length;
    }
    restore(after);
  }
  function stepHistory(direction: 'undo' | 'redo') {
    const entry = direction === 'undo' ? history[applied - 1] : history[applied];
    if (!entry) return;
    applied += direction === 'undo' ? -1 : 1;
    const next = direction === 'undo' ? entry.before : entry.after;
    // Changing only the rules form is outside history. A record edit must preserve it.
    restore(
      sameRulesEffect(entry.before.rules, entry.after.rules)
        ? { ...next, rules: state.rules }
        : next,
    );
  }
  function saved(id: number) {
    const wasChanged = savedId !== state.editId;
    savedId = id;
    if (saveAsFirst || wasChanged !== (id !== state.editId)) revision++;
    saveAsFirst = false;
  }
  function exportText(options: Partial<ExportOptions> = {}) {
    const kept = options.scope === 'branch' ? new Set(selected()) : null;
    const props = (n: Node) => {
      const values = new Map<string, string[]>();
      const add = (k: string, v: string) => values.set(k, [...(values.get(k) ?? []), v]);
      const coord = (p: Point) => String.fromCharCode(97 + p.x, 97 + p.y);
      if (n.parent === null) {
        const fields = {
          black: 'PB',
          white: 'PW',
          blackRank: 'BR',
          whiteRank: 'WR',
          result: 'RE',
          date: 'DT',
          event: 'EV',
          round: 'RO',
          gameName: 'GN',
          place: 'PC',
          handicap: 'HA',
        } as const;
        for (const k of Object.keys(fields) as (keyof GameInfo)[])
          if (state.info[k] !== null) add(fields[k], String(state.info[k]));
        if (!sameRulesEffect(state.rules, fromFile)) {
          add('KM', String(komiOf(state.rules)));
          add('RU', ruleName(state.rules));
        } else {
          if (source.km) add('KM', source.km);
          if (source.ru) add('RU', source.ru);
        }
      }
      if (n.mv) add(n.color === 'black' ? 'B' : 'W', n.mv.type === 'pass' ? '' : coord(n.mv));
      for (const [i, c] of Object.entries(n.setup))
        add(c === 'black' ? 'AB' : c === 'white' ? 'AW' : 'AE', coord(point(Number(i))));
      if (n.pl) add('PL', n.pl === 'black' ? 'B' : 'W');
      if (n.comment && !options.clean) add('C', n.comment);
      for (const { mark, point: p } of n.marks) {
        const key = { label: 'LB', triangle: 'TR', circle: 'CR', square: 'SQ', cross: 'MA' }[
          mark.kind
        ];
        add(key, coord(p) + (mark.kind === 'label' ? ':' + mark.text : ''));
      }
      return [...values]
        .map(
          ([k, vs]) =>
            k +
            vs.map((v) => '[' + v.replaceAll('\\', '\\\\').replaceAll(']', '\\]') + ']').join(''),
        )
        .join('');
    };
    function write(id: number): string {
      const n = get(id),
        children = n.children.filter((c) => !get(c).tryout && (!kept || kept.has(c)));
      const root = id === 0 ? 'GM[1]FF[4]CA[UTF-8]SZ[' + size + ']' : '';
      if (id === 0 && !children.length && !props(n) && !(options.clean && n.comment))
        throw new TransportError('gameEmpty', 'nothing to save');
      return (
        ';' +
        root +
        props(n) +
        (children.length === 1
          ? write(children[0])
          : children.map((c) => '(' + write(c) + ')').join(''))
      );
    }
    return '(' + write(0) + ')\n';
  }
  function preview(moves: Move[]): Preview {
    const board = structuredClone(position(state.current)),
      captured: Point[][] = [];
    let color = board.next;
    let illegalAt: number | null = null;
    for (const [i, mv] of moves.entries()) {
      captured.push(applyMove(board, size, color, mv).map(point));
      if (board.illegal) illegalAt ??= i;
      color = other(color);
    }
    return { stones: board.stones, captured, illegalAt };
  }
  return {
    snapshot,
    tree,
    line,
    mainLine: () => line(0),
    navigate,
    edit,
    preview,
    play: (mv: Move) => edit({ kind: 'play', mv }),
    undo: () => stepHistory('undo'),
    redo: () => stepHistory('redo'),
    onMainLine: () => !here().tryout && variation(state.current) === undefined,
    exportText,
    saved,
    editId: () => state.editId,
  };
}
