import { afterEach, expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { createFakeTransport } from '../transport/fake';
import { TransportError } from '../transport/transport';
import { edit, redo, undo } from './editActions';
import { useGameStore, resetGameStore } from './gameStore';
import { resetNotices, useNoticeStore } from './noticeStore';
import { makeSnapshot } from './testing';

const t = createI18n('zh-CN').t;
afterEach(() => {
  resetGameStore();
  resetNotices();
});

it.each([
  ['gameIllegalMove', 'occupied', 'notice.illegalMove.occupied'],
  ['gameIllegalMove', 'ko', 'notice.illegalMove.ko'],
  ['gameIllegalMove', 'offBoard', 'notice.illegalMove.offBoard'],
  ['gameIllegalMove', 'suicide', 'notice.illegalMove.suicide'],
  ['gameEndTryoutFirst', undefined, 'notice.endTryoutFirst'],
  ['gameNoSuchNode', undefined, 'notice.noSuchNode'],
] as const)('shows the refusal notice for %s %s', async (code, reason, label) => {
  const transport = createFakeTransport(() => {
    throw new TransportError(code, 'diagnostic', reason);
  });
  const ctx = { transport, files: createFakeFiles(), t };
  expect(await edit(ctx, { kind: 'pass' })).toBe(false);
  const title = useNoticeStore.getState().notice?.title;
  expect(title).toBe(t(label));
  expect(title).not.toBe(label);
  expect(useGameStore.getState().snapshot).toBeNull();
});

it('applies successful edit, undo and redo replies through the game store', async () => {
  const requests: string[] = [];
  const transport = createFakeTransport((request) => {
    requests.push(request.type);
    return { type: 'game', warnings: [], snapshot: makeSnapshot({ revision: requests.length }) };
  });
  const ctx = { transport, files: createFakeFiles(), t };
  for (const [i, change] of [
    () => edit(ctx, { kind: 'pass' }),
    () => undo(ctx),
    () => redo(ctx),
  ].entries()) {
    expect(await change()).toBe(true);
    expect(useGameStore.getState().snapshot?.revision).toBe(i + 1);
  }
  expect(requests).toEqual(['gameEdit', 'gameUndo', 'gameRedo']);
});

it('a superseded reply stops a chained edit while a matching snapshot event acknowledges it', async () => {
  const snapshot = makeSnapshot({ revision: 4, tryout: 0 });
  const ctx = {
    transport: createFakeTransport(() => ({ type: 'game', warnings: [], snapshot })),
    files: createFakeFiles(),
    t,
  };
  useGameStore.getState().apply(snapshot);
  expect(await edit(ctx, { kind: 'tryoutStart' })).toBe(true);
  useGameStore.getState().apply(makeSnapshot({ revision: 5, tryout: null }));
  expect(await edit(ctx, { kind: 'tryoutStart' })).toBe(false);
  expect(useGameStore.getState().snapshot?.tryout).toBeNull();
});
