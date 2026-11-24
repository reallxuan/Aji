import { expect, it } from 'vitest';
import { createFakeTree } from './fakeTree';

const stone = (x: number, y: number) => ({ type: 'play' as const, x, y });

it('fake plays variations and undoes them', () => {
  const t = createFakeTree(9, [stone(0, 0), stone(1, 0)]);
  t.navigate('next');
  t.play(stone(2, 0));
  const branch = t.snapshot();
  expect(branch.placed.at(-1)).toMatchObject({ branchNumber: 1, number: 2 });
  t.navigate('first');
  t.navigate('last');
  expect(t.snapshot()).toMatchObject({ node: branch.node, lineRevision: branch.lineRevision });
  t.undo();
  expect(t.snapshot()).toMatchObject({ node: 1, changed: false });
  t.redo();
  expect(t.snapshot()).toMatchObject({ node: branch.node, changed: true });
  t.navigate('previousSibling');
  expect(t.snapshot().lastMove).toEqual(stone(1, 0));
  t.navigate('previous');
  t.play(stone(1, 0));
  expect(t.tree().nodes).toHaveLength(4);
  t.edit({ kind: 'promote', node: branch.node });
  expect(t.tree().nodes.map((n) => n.id)).toEqual([0, 1, branch.node, 2]);
  t.edit({ kind: 'deleteBranch', node: 2 });
  expect(t.snapshot().node).toBe(1);
});

it('both pass commands make undoable scratch moves', () => {
  for (const pass of [{ kind: 'pass' }, { kind: 'play', mv: { type: 'pass' } }] as const) {
    const t = createFakeTree(9, []);
    t.edit({ kind: 'tryoutStart' });
    t.edit(pass);
    const scratch = t.snapshot().node;
    expect(t.line().at(-1)).toMatchObject({ tryout: true, move: { type: 'pass' } });
    expect(t.snapshot().changed).toBe(false);
    t.undo();
    expect(t.snapshot()).toMatchObject({ node: 0, changed: false });
    t.redo();
    expect(t.snapshot()).toMatchObject({ node: scratch, changed: false });
  }
});

it('fake try-out ends in one step', () => {
  const t = createFakeTree(9, [stone(0, 0)]);
  t.edit({ kind: 'tryoutStart' });
  t.play(stone(1, 1));
  const a = t.snapshot().node;
  t.play(stone(2, 2));
  expect(t.line().at(-1)).toMatchObject({ tryout: true });
  t.edit({ kind: 'setComment', node: a, text: 'scratch' });
  expect(() => t.edit({ kind: 'setComment', node: 0, text: 'kept' })).toThrow(
    expect.objectContaining({ code: 'gameEndTryoutFirst' }),
  );
  expect(t.exportText()).not.toContain('scratch');
  t.edit({ kind: 'tryoutEnd' });
  expect(t.snapshot()).toMatchObject({ node: 0, changed: false, tryout: null });
  expect(t.tree().nodes).toHaveLength(2);
  t.undo();
  expect(t.snapshot()).toMatchObject({ tryout: 0, changed: false });
  t.edit({ kind: 'tryoutKeep', node: a });
  expect(t.snapshot()).toMatchObject({ tryout: null, changed: true });
  expect(t.exportText()).toContain('C[scratch]');
});

it('derives captures, PL and setup-only trend slots and exports node edits', () => {
  const t = createFakeTree(9, []);
  t.edit({ kind: 'setupStone', point: { x: 0, y: 0 }, stone: 'black' });
  t.edit({ kind: 'setupStone', point: { x: 1, y: 0 }, stone: 'white' });
  t.edit({ kind: 'setToPlay', color: 'white' });
  t.play(stone(0, 1));
  expect(t.snapshot()).toMatchObject({ captures: [0, 1], moveNumber: 1 });
  expect(t.snapshot().stones[0]).toBeNull();
  expect(() => t.play(stone(0, 0))).toThrow(expect.objectContaining({ code: 'gameIllegalMove' }));
  t.edit({ kind: 'setToPlay', color: 'white' });
  expect(t.line().map((n) => [n.moveNumber, n.toPlay, n.mover])).toEqual([
    [0, 'white', null],
    [1, 'black', 'white'],
    [1, 'white', null],
  ]);
  const before = t.snapshot();
  t.edit({
    kind: 'setMark',
    node: before.node,
    point: { x: 1, y: 1 },
    mark: { kind: 'label', text: 'A' },
  });
  t.edit({ kind: 'setInfo', field: 'black', value: 'Lee' });
  expect(t.snapshot()).toMatchObject({
    lineRevision: before.lineRevision,
    treeRevision: before.treeRevision,
  });
  const text = t.exportText();
  for (const prop of ['AB[aa]', 'AW[ba]', 'PL[W]', 'W[ab]', 'LB[bb:A]', 'PB[Lee]'])
    expect(text).toContain(prop);
});

it('keeps the selected rules form when undoing and redoing a move', () => {
  const t = createFakeTree(9, []);
  t.play(stone(1, 1));
  const rules = { kind: 'custom', komi: 7.5, scoring: 'area', details: null } as const;
  t.edit({ kind: 'setRules', rules });
  t.undo();
  expect(t.snapshot().rules.current).toEqual(rules);
  t.redo();
  expect(t.snapshot().rules.current).toEqual(rules);
});

it('preserves detailed rules in the exported SGF', () => {
  const t = createFakeTree(9, []);
  t.edit({
    kind: 'setRules',
    rules: {
      kind: 'custom',
      komi: 7,
      scoring: 'area',
      details: {
        ko: 'positional',
        tax: 'all',
        suicide: true,
        hasButton: false,
        whiteHandicapBonus: 'n',
        friendlyPassOk: false,
      },
    },
  });
  expect(t.exportText()).toContain('RU[koPOSITIONALscoreAREAtaxALLsui1whbN]');
});

it('looks through a PL-only node for the next move', () => {
  const t = createFakeTree(9, [stone(0, 0)]);
  t.navigate('last');
  t.edit({ kind: 'setToPlay', color: 'black' });
  t.play(stone(1, 1));
  t.navigate({ move: 1 });
  expect(t.snapshot().nextMove).toEqual(stone(1, 1));
});

it('a suicide in a preview leaves its other stones and captures intact', () => {
  const t = createFakeTree(9, []);
  for (const p of [stone(1, 0), stone(1, 1), stone(0, 2)])
    t.edit({ kind: 'setupStone', point: p, stone: 'white' });
  t.edit({ kind: 'setupStone', point: stone(0, 1), stone: 'black' });
  expect(t.preview([stone(0, 0)])).toMatchObject({
    illegalAt: 0,
    stones: t.snapshot().stones,
    captured: [[]],
  });
});

it('refuses a simple ko recapture, then allows it after two passes', () => {
  const t = createFakeTree(9, []);
  for (const p of [stone(2, 0), stone(1, 1), stone(3, 1)])
    t.edit({ kind: 'setupStone', point: p, stone: 'black' });
  for (const p of [stone(2, 1), stone(1, 2), stone(3, 2), stone(2, 3)])
    t.edit({ kind: 'setupStone', point: p, stone: 'white' });
  t.play(stone(2, 2));
  expect(t.snapshot().captures).toEqual([1, 0]);
  expect(() => t.play(stone(2, 1))).toThrow(
    expect.objectContaining({ code: 'gameIllegalMove', detail: 'ko' }),
  );
  t.play({ type: 'pass' });
  t.play({ type: 'pass' });
  t.play(stone(2, 1));
  expect(t.snapshot().captures).toEqual([1, 1]);
});

it('shares the engine key with its parent after the last setup stone is removed', () => {
  const t = createFakeTree(9, [stone(1, 1)]);
  t.navigate('last');
  const parent = t.snapshot();
  t.edit({ kind: 'setupStone', point: stone(2, 2), stone: 'white' });
  t.edit({ kind: 'setupStone', point: stone(2, 2), stone: null });
  t.edit({ kind: 'setComment', node: t.snapshot().node, text: 'a comment-only node' });
  expect(t.line().at(-1)).toMatchObject({
    key: parent.positionKey,
    toPlay: parent.nextColor,
    mover: null,
  });
  expect(t.exportText({ clean: true })).not.toContain('C[a comment-only node]');
});
