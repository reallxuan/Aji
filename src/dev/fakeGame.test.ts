import { describe, expect, it } from 'vitest';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { Move } from '../transport/generated/Move';
import type { Request } from '../transport/generated/Request';
import { TransportError } from '../transport/transport';
import { createFakeGame, fakeAnalysis } from './fakeGame';

function setUp() {
  const events: AppEvent[] = [];
  const handle = createFakeGame((event) => events.push(event));
  const ask = (request: Request) => {
    const reply = handle(request);
    if (reply?.type !== 'game') throw new Error(`no game reply to ${request.type}`);
    return reply;
  };
  return { events, handle, ask };
}

const count = (snapshot: GameSnapshot) => snapshot.stones.filter(Boolean).length;

describe('the scenarios’ fake game', () => {
  it('opens the Samsung game and plays it to the end with captures', () => {
    const { ask, events } = setUp();
    const opened = ask({
      type: 'gameOpen',
      name: 'samsung-30-final-2.sgf',
      bytes: '',
      atEnd: false,
    });
    expect(opened.snapshot).toMatchObject({ moveNumber: 0, lineLength: 242, atStart: true });
    expect(opened.snapshot.info.event).toBe('第30届三星杯决赛');

    const end = ask({ type: 'gameNavigate', to: 'last' }).snapshot;
    const [byBlack, byWhite] = end.captures;
    expect(byBlack + byWhite).toBeGreaterThan(0);
    // Every move leaves a stone, less the ones captured.
    expect(count(end)).toBe(242 - byBlack - byWhite);
    expect(end).toMatchObject({ atEnd: true, nextColor: 'black' });
    // Opening pushes the trend too, as the backend does.
    expect(events.map((e) => e.type)).toEqual([
      'gameSnapshot',
      'gameTree',
      'gameTrend',
      'gameSnapshot',
    ]);
  });

  it('opens at the requested end with placed stones and the one-line tree', () => {
    const { ask, handle } = setUp();
    const { snapshot } = ask({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: true });
    expect(snapshot.node).toBe(242);
    expect(snapshot.placed).toHaveLength(count(snapshot));
    const tree = handle({ type: 'gameTree' });
    if (tree?.type !== 'gameTree') throw new Error('no tree');
    expect(tree.revision).toBe(snapshot.treeRevision);
    expect(tree.nodes).toHaveLength(243);
    expect(tree.nodes[1]).toEqual({
      id: 1,
      parent: 0,
      color: 'black',
      mv: { type: 'play', x: 15, y: 3 },
      flags: 0,
    });
    expect(ask({ type: 'gameNavigate', to: 'first' }).snapshot.continuations).toEqual([
      { node: 1, mv: tree.nodes[1].mv, tryout: false },
    ]);
  });

  it('navigates by node and stays put on a linear fixture without siblings', () => {
    const { ask } = setUp();
    ask({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: false });
    for (const to of [
      { node: 2 },
      'nextSibling',
      'previousSibling',
      'branchPoint',
      'mainLine',
      { node: 999 },
    ] as const) {
      expect(ask({ type: 'gameNavigate', to }).snapshot.lineIndex).toBe(2);
    }
  });

  it('flags a move onto an occupied point and gives it no position', () => {
    const { ask } = setUp();
    const opened = ask({ type: 'gameOpen', name: 'illegal-ko.sgf', bytes: '', atEnd: false });
    expect(opened.warnings).toEqual([{ code: 'illegalMoves' }]);
    const third = ask({ type: 'gameNavigate', to: { move: 3 } }).snapshot;
    expect(third).toMatchObject({ illegal: 'occupied', positionKey: null, size: 9 });
    expect(ask({ type: 'gameNavigate', to: 'next' }).snapshot.illegal).toBeNull();
  });

  it('fails the way the backend does for the canned bad files', () => {
    const { handle } = setUp();
    const open = (name: string) => () =>
      handle({ type: 'gameOpen', name, bytes: '', atEnd: false });
    expect(open('size-19x13.sgf')).toThrow(
      expect.objectContaining({ code: 'sgfUnsupportedSize', detail: '19x13' }),
    );
    expect(open('not-go.sgf')).toThrow(TransportError);
  });

  it('keeps the selected rules form when its effect is unchanged', () => {
    const { ask, events } = setUp();
    const rules = { kind: 'custom', details: null, komi: 7.5, scoring: 'area' } as const;
    const snapshot = ask({ type: 'gameEdit', edit: { kind: 'setRules', rules } }).snapshot;
    expect(snapshot.rules).toMatchObject({ current: rules, changed: false });
    expect(events.map((event) => event.type)).toEqual(['gameSnapshot']);
  });

  it('keeps the rules it is given until restored to the file’s', () => {
    const { ask } = setUp();
    ask({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: false });
    const custom = { kind: 'custom', details: null, komi: 7, scoring: 'area' } as const;
    expect(
      ask({ type: 'gameEdit', edit: { kind: 'setRules', rules: custom } }).snapshot.rules,
    ).toMatchObject({
      current: custom,
      changed: true,
    });
    expect(
      ask({ type: 'gameEdit', edit: { kind: 'setRules', rules: null } }).snapshot.rules.changed,
    ).toBe(false);
  });

  it('gives the line index and the move played next', () => {
    const { ask } = setUp();
    ask({ type: 'gameOpen', name: 'samsung-30-final-2.sgf', bytes: '', atEnd: false });
    const at3 = ask({ type: 'gameNavigate', to: { move: 3 } }).snapshot;
    expect(at3.lineIndex).toBe(3);
    // The record opens pd dd dp pq: the fourth move is pq, Q3.
    expect(at3.nextMove).toEqual({ type: 'play', x: 15, y: 16 });
    expect(ask({ type: 'gameNavigate', to: 'last' }).snapshot.nextMove).toBeNull();
  });

  it('answers the trend with a node per main-line node', () => {
    const { ask, handle } = setUp();
    ask({ type: 'gameOpen', name: 'samsung-30-final-2.sgf', bytes: '', atEnd: false });
    const reply = handle({ type: 'gameTrend' });
    if (reply?.type !== 'trend') throw new Error('no trend');
    expect(reply.nodes).toHaveLength(243);
    expect(reply.nodes[0]).toEqual({
      node: 0,
      key: '0000000000001000',
      moveNumber: 0,
      mover: null,
      move: null,
      stats: null,
      loss: null,
    });
    expect(reply.nodes[2]).toMatchObject({ moveNumber: 2, mover: 'white' });
  });
});

describe('the fake analysis', () => {
  it('is deterministic and on empty points', () => {
    const { ask } = setUp();
    ask({ type: 'gameOpen', name: 'samsung-30-final-2.sgf', bytes: '', atEnd: false });
    const snapshot = ask({ type: 'gameNavigate', to: { move: 120 } }).snapshot;
    const a = fakeAnalysis(snapshot, 400);
    expect(fakeAnalysis(snapshot, 400)).toEqual(a);
    expect(a.position).toBe(snapshot.positionKey);
    expect(a.rootVisits).toBe(400);
    expect(a.candidates).toHaveLength(6);
    const where = (m: Move) => (m.type === 'play' ? m.y * 19 + m.x : -1);
    const empty = (m: Move) => m.type === 'play' && snapshot.stones[where(m)] === null;
    expect(new Set(a.candidates.map((c) => where(c.move))).size).toBe(6);
    for (const c of a.candidates) {
      expect(empty(c.move)).toBe(true);
      expect(c.pv[0]).toEqual(c.move);
      expect(c.pv.length).toBeGreaterThan(1);
      expect(c.pv.every(empty)).toBe(true);
      expect(new Set(c.pv.map(where)).size).toBe(c.pv.length);
    }
    const other = ask({ type: 'gameNavigate', to: { move: 121 } }).snapshot;
    expect(fakeAnalysis(other, 400).candidates).not.toEqual(a.candidates);
  });
});
