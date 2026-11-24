import { afterEach, expect, it, vi } from 'vitest';
import { TransportError } from '../transport/transport';
import { scenarioTransport } from '../dev/scenarios';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { edit, undo, redo } from './editActions';
import { setupEdit } from '../edit/setupEdit';
import { useModeStore } from '../edit/modeStore';
import {
  openDropped,
  openFromPicker,
  openRecent,
  requestQuit,
  save,
  saveAs,
  saveBranch,
  saveClean,
  startNewGame,
} from './actions';
import { resetGameStore, useGameStore } from './gameStore';
import { resetNotices, useNoticeStore } from './noticeStore';
import { writeRootField } from './fieldWrites';

afterEach(() => {
  resetGameStore();
  resetNotices();
});

async function setup(path = '/game.sgf', savePath: string | null = '/copy.sgf') {
  const transport = scenarioTransport('game')!;
  const files = createFakeFiles({
    files: { [path]: '(;)', '/other.sgf': '(;)' },
    pick: path,
    savePath,
    recent: ['/other.sgf'],
  });
  const t = createI18n('en').t;
  const ctx = { transport, files, t };
  await openFromPicker(ctx);
  return ctx;
}
const state = () => useGameStore.getState().snapshot!;
const comment = (ctx: Awaited<ReturnType<typeof setup>>, text: string) =>
  edit(ctx, { kind: 'setComment', node: state().node, text });

it('save in place writes bytes and marks saved', async () => {
  const ctx = await setup();
  await comment(ctx, 'review');
  await save(ctx);
  expect(ctx.files.saveRequests).toEqual([]);
  expect(ctx.files.written.get('/game.sgf')).toContain('C[review]');
  expect(state().changed).toBe(false);
});

it('an oversized export preserves the original file and provides a localized way to save a copy', async () => {
  const ctx = await setup();
  await comment(ctx, 'review');
  const request = ctx.transport.request.bind(ctx.transport);
  const calls = vi.spyOn(ctx.transport, 'request').mockImplementation((req) => {
    if (req.type === 'gameExport' && req.options.inPlace)
      throw new TransportError('sgfTooLarge', 'encoded file exceeds the size limit');
    return request(req);
  });
  expect(await save(ctx)).toBe(false);
  expect(ctx.files.written.has('/game.sgf')).toBe(false);
  expect(calls).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gameSaved' }));
  expect(state().changed).toBe(true);
  expect(useNoticeStore.getState().notice?.detail).toMatch(/20 MB.*Save As/);
  expect(await saveAs(ctx)).toBe(true);
  expect(ctx.files.written.get('/copy.sgf')).toContain('C[review]');
});

it('save without a token is save as', async () => {
  const ctx = await setup();
  await startNewGame(ctx, 9);
  await comment(ctx, 'header only');
  await save(ctx);
  expect(ctx.files.written.get('/copy.sgf')).toContain('C[header only]');
  expect(ctx.files.written.has('/game.sgf')).toBe(false);
});

it('save_as_first goes to save as once', async () => {
  const ctx = await setup('/truncated.sgf');
  await comment(ctx, 'first');
  await save(ctx);
  await comment(ctx, 'second');
  await save(ctx);
  expect(ctx.files.saveRequests).toHaveLength(1);
  expect(ctx.files.written.get('/copy.sgf')).toContain('C[second]');
  expect(ctx.files.written.has('/truncated.sgf')).toBe(false);
});

it('a_failed_write_keeps_the_game_changed', async () => {
  const ctx = await setup();
  await comment(ctx, 'review');
  ctx.files.save = async () => false;
  await save(ctx);
  expect(state().changed).toBe(true);
  expect(useNoticeStore.getState().notice?.title).toBe("Couldn't save the game");
});

it.each([
  [saveBranch, 'branch', false],
  [saveClean, 'game', true],
] as const)('%s does not adopt the copy or mark it saved', async (copy, scope, clean) => {
  const ctx = await setup();
  await comment(ctx, 'review');
  const rpc = vi.spyOn(ctx.transport, 'request');
  await copy(ctx);
  expect(rpc).toHaveBeenCalledWith({
    type: 'gameExport',
    options: { scope, clean, inPlace: false },
  });
  expect(state().changed).toBe(true);
  expect(ctx.files.remembered.map((f) => f.path)).toEqual(['/game.sgf']);
  expect(ctx.files.written.has('/copy.sgf')).toBe(true);
  await save(ctx);
  expect(ctx.files.written.get('/game.sgf')).toContain('C[review]');
});

it.each(['picker', 'drop', 'recent', 'new'] as const)(
  '%s asks before discarding changes',
  async (operation) => {
    const ctx = await setup();
    await comment(ctx, 'keep');
    ctx.files.confirmDiscard = vi.fn(async () => 'cancel' as const);
    const before = state();
    if (operation === 'picker') await openFromPicker(ctx);
    if (operation === 'drop') await openDropped(ctx, ['/other.sgf']);
    if (operation === 'recent') await openRecent(ctx, 1);
    if (operation === 'new') await startNewGame(ctx, 9);
    expect(ctx.files.confirmDiscard).toHaveBeenCalledOnce();
    expect(state()).toBe(before);
  },
);

it('opens the selected recent entry even when Save As changes the list', async () => {
  const ctx = await setup('/truncated.sgf');
  await comment(ctx, 'review');
  ctx.files.confirmDiscard = async () => 'save';
  await openRecent(ctx, 1);
  expect(ctx.files.written.get('/copy.sgf')).toContain('C[review]');
  expect(ctx.files.remembered.at(-1)?.path).toBe('/other.sgf');
});

it('a newer edit during save cancels the requested replacement', async () => {
  const ctx = await setup();
  await comment(ctx, 'first');
  ctx.files.confirmDiscard = async () => 'save';
  const write = ctx.files.save;
  ctx.files.save = async (...args) => {
    await comment(ctx, 'newer');
    return write(...args);
  };
  await startNewGame(ctx, 9);
  expect(ctx.files.written.get('/game.sgf')).toContain('C[first]');
  expect(state()).toMatchObject({ comment: 'newer', changed: true });
});

it('a Save As returning after replacement cannot mark or adopt a file on the new game', async () => {
  const ctx = await setup();
  await comment(ctx, 'first');
  ctx.files.confirmDiscard = async () => 'discard';
  const write = ctx.files.saveAs;
  ctx.files.saveAs = async (...args) => {
    await startNewGame(ctx, 9);
    await comment(ctx, 'newer');
    return write(...args);
  };
  await saveAs(ctx);
  expect(state()).toMatchObject({ size: 9, changed: true });
  expect(ctx.files.remembered.map((f) => f.path)).toEqual(['/game.sgf']);
});

it('serializes overlapping saves so the last file has the latest edit', async () => {
  const ctx = await setup();
  await comment(ctx, 'first');
  let began!: () => void;
  let finish!: () => void;
  const writing = new Promise<void>((r) => (began = r));
  const pending = new Promise<void>((r) => (finish = r));
  const write = ctx.files.save;
  vi.spyOn(ctx.files, 'save').mockImplementationOnce(async (...args) => {
    began();
    await pending;
    return write(...args);
  });
  const first = save(ctx);
  await writing;
  await comment(ctx, 'last');
  const last = save(ctx);
  finish();
  await Promise.all([first, last]);
  expect(ctx.files.written.get('/game.sgf')).toContain('C[last]');
  expect(state().changed).toBe(false);
});

it('a failed root draft prevents Save and still permits explicit Discard', async () => {
  const ctx = await setup();
  const rpc = ctx.transport.request.bind(ctx.transport);
  vi.spyOn(ctx.transport, 'request').mockImplementation((req) =>
    req.type === 'gameEdit' ? Promise.reject(Error('offline')) : rpc(req),
  );
  await writeRootField(ctx, state().gameRevision, {
    kind: 'setInfo',
    field: 'event',
    value: 'tournament',
  });
  ctx.files.confirmDiscard = async () => 'save';
  await startNewGame(ctx, 9);
  expect(state().size).toBe(19);
  expect(ctx.files.written.size).toBe(0);
  ctx.files.confirmDiscard = async () => 'discard';
  await startNewGame(ctx, 9);
  expect(state().size).toBe(9);
});

it('keeps a draft when Discard is followed by cancelling the file picker', async () => {
  const ctx = await setup();
  const rpc = ctx.transport.request.bind(ctx.transport);
  let offline = true;
  vi.spyOn(ctx.transport, 'request').mockImplementation((req) =>
    req.type === 'gameEdit' && offline ? Promise.reject(Error('offline')) : rpc(req),
  );
  await writeRootField(ctx, state().gameRevision, {
    kind: 'setInfo',
    field: 'event',
    value: 'tournament',
  });
  ctx.files.confirmDiscard = async () => 'discard';
  ctx.files.pickOpen = async () => null;
  await openFromPicker(ctx);
  offline = false;
  await save(ctx);
  expect(ctx.files.written.get('/game.sgf')).toContain('EV[tournament]');
});

it('rechecks a newer edit while the selected file is still being read', async () => {
  const ctx = await setup();
  const read = ctx.files.openPath;
  ctx.files.openPath = async (path) => {
    await comment(ctx, 'edit during read');
    return read(path);
  };
  ctx.files.confirmDiscard = async () => 'cancel';
  await openDropped(ctx, ['/other.sgf']);
  expect(state().comment).toBe('edit during read');
});

it('reports an encoding fallback after an in-place write and acknowledges UTF-8', async () => {
  const ctx = await setup();
  await comment(ctx, '🎲');
  const rpc = ctx.transport.request.bind(ctx.transport);
  const calls = vi.spyOn(ctx.transport, 'request').mockImplementation(async (req) => {
    const out = await rpc(req);
    return out.type === 'gameExport' ? { ...out, fellBack: true } : out;
  });
  await save(ctx);
  expect(useNoticeStore.getState().notice?.title).toContain('UTF-8');
  expect(calls).toHaveBeenCalledWith(expect.objectContaining({ type: 'gameSaved', utf8: true }));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
}

it.each(['quit', 'new'] as const)(
  'drains a pending board edit before %s decides the record is clean',
  async (op) => {
    const ctx = await setup();
    const before = state().gameRevision;
    const slow = deferred();
    const rpc = ctx.transport.request.bind(ctx.transport);
    vi.spyOn(ctx.transport, 'request').mockImplementation(async (req) => {
      if (req.type === 'gameEdit') await slow.promise;
      return rpc(req);
    });
    const quit = vi.spyOn(ctx.files, 'quit');
    ctx.files.confirmDiscard = vi.fn(async () => 'cancel' as const);
    const move = edit(ctx, { kind: 'pass' });
    const leave = op === 'quit' ? requestQuit(ctx) : startNewGame(ctx, 9);
    await new Promise((r) => setTimeout(r, 0));
    slow.resolve();
    await Promise.all([move, leave]);
    expect(ctx.files.confirmDiscard).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ changed: true, gameRevision: before });
  },
);

it('rereads the picked token when revalidation saves to the same path', async () => {
  const ctx = await setup('/truncated.sgf', '/other.sgf');
  const read = ctx.files.openPath;
  ctx.files.pickOpen = async () => {
    const old = await read('/other.sgf');
    await comment(ctx, 'typed before picker returned');
    return old;
  };
  ctx.files.confirmDiscard = async () => 'save';
  const rpc = vi.spyOn(ctx.transport, 'request');
  await openFromPicker(ctx);
  const reopened = rpc.mock.calls.map(([r]) => r).find((r) => r.type === 'gameOpen');
  expect(reopened?.bytes).toBe((await read('/other.sgf')).bytes);
  expect(ctx.files.written.get('/other.sgf')).toContain('typed before picker returned');
});

it('revalidates a change accepted by the service while open is pending', async () => {
  const ctx = await setup();
  const before = state().gameRevision;
  const rpc = ctx.transport.request.bind(ctx.transport);
  vi.spyOn(ctx.transport, 'request').mockImplementation(async (req) => {
    if (req.type === 'gameOpen')
      await rpc({
        type: 'gameEdit',
        edit: { kind: 'setComment', node: 0, text: 'remote while parsing' },
      });
    return rpc(req);
  });
  ctx.files.confirmDiscard = vi.fn(async () => 'cancel' as const);
  await openDropped(ctx, ['/other.sgf']);
  expect(state()).toMatchObject({
    gameRevision: before,
    changed: true,
    comment: 'remote while parsing',
  });
  expect(ctx.files.confirmDiscard).toHaveBeenCalledOnce();
});

it.each(['undo', 'redo'] as const)('awaits an in-flight %s before quit', async (direction) => {
  const ctx = await setup();
  await comment(ctx, 'saved version');
  if (direction === 'redo') await undo(ctx);
  await save(ctx);
  const delayed = deferred();
  const rpc = ctx.transport.request.bind(ctx.transport);
  vi.spyOn(ctx.transport, 'request').mockImplementation(async (req) => {
    if (req.type === 'gameUndo' || req.type === 'gameRedo') await delayed.promise;
    return rpc(req);
  });
  ctx.files.confirmDiscard = vi.fn(async () => 'cancel' as const);
  const quit = vi.spyOn(ctx.files, 'quit');
  const move = (direction === 'undo' ? undo : redo)(ctx);
  const leave = requestQuit(ctx);
  await new Promise((r) => setTimeout(r, 0));
  delayed.resolve();
  await Promise.all([move, leave]);
  expect(ctx.files.confirmDiscard).toHaveBeenCalledOnce();
  expect(quit).not.toHaveBeenCalled();
  expect(state().changed).toBe(true);
});

it('drains queued setup taps before asking which record to leave', async () => {
  const ctx = await setup();
  const first = deferred();
  const second = deferred();
  const beganSecond = deferred();
  const rpc = ctx.transport.request.bind(ctx.transport);
  let count = 0;
  vi.spyOn(ctx.transport, 'request').mockImplementation(async (req) => {
    if (req.type === 'gameEdit') {
      if (++count === 1) await first.promise;
      else {
        beganSecond.resolve();
        await second.promise;
      }
    }
    return rpc(req);
  });
  ctx.files.confirmDiscard = vi.fn(async () => 'cancel' as const);
  useModeStore.getState().setMode('setup');
  try {
    setupEdit(ctx, () => ({ kind: 'setupStone', point: { x: 4, y: 4 }, stone: 'black' }));
    setupEdit(ctx, () => ({ kind: 'setupStone', point: { x: 5, y: 4 }, stone: 'white' }));
    const leave = requestQuit(ctx);
    first.resolve();
    await beganSecond.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.files.confirmDiscard).not.toHaveBeenCalled();
    second.resolve();
    await leave;
    expect(ctx.files.confirmDiscard).toHaveBeenCalledOnce();
  } finally {
    second.resolve();
    useModeStore.getState().setMode('normal');
  }
});

it('pauses local record input while the final replacement RPC is pending', async () => {
  const ctx = await setup();
  const started = deferred(),
    finish = deferred();
  const rpc = ctx.transport.request.bind(ctx.transport);
  const requests = vi.spyOn(ctx.transport, 'request').mockImplementation(async (req) => {
    if (req.type === 'gameOpen') {
      started.resolve();
      await finish.promise;
    }
    return rpc(req);
  });
  const previous = document.body.inert;
  const leaving = openDropped(ctx, ['/other.sgf']);
  await started.promise;
  try {
    expect(document.body.inert).toBe(true);
    expect(await edit(ctx, { kind: 'pass' })).toBe(false);
    expect(await saveClean(ctx)).toBe(false);
    expect(requests.mock.calls.some(([r]) => r.type === 'gameExport')).toBe(false);
    expect(requests.mock.calls.some(([r]) => r.type === 'gameEdit')).toBe(false);
  } finally {
    finish.resolve();
    await leaving;
  }
  expect(document.body.inert).toBe(previous);
  expect(state().name).toBe('other');
});

it.each([
  ['Save Clean', saveClean],
  ['Save Branch', saveBranch],
  ['Save As', saveAs],
] as const)(
  'opens the bytes an independently pending %s writes to the selected recent file',
  async (_, copy) => {
    const ctx = await setup('/game.sgf', '/other.sgf');
    const writing = deferred();
    const release = deferred();
    const selected = deferred();
    const write = ctx.files.saveAs;
    ctx.files.saveAs = async (...args) => {
      writing.resolve();
      await release.promise;
      return write(...args);
    };
    const read = ctx.files.openRecent;
    ctx.files.openRecent = async (index) => {
      const file = await read(index);
      selected.resolve();
      return file;
    };
    const rpc = vi.spyOn(ctx.transport, 'request');
    const copying = copy(ctx);
    await writing.promise;
    const opening = openRecent(ctx, 1);
    await selected.promise;
    // Let the opener reach its commit point while the write is still on disk's side.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release.resolve();
    await Promise.all([copying, opening]);
    const written = await ctx.files.reread('/other.sgf');
    expect(written).not.toBe(btoa('(;)'));
    expect(rpc.mock.calls.map(([r]) => r).find((r) => r.type === 'gameOpen')?.bytes).toBe(written);
    expect(state()).toMatchObject({ name: 'other', changed: false });
  },
);

it('also waits for a second copy queued while open is waiting for the first', async () => {
  const ctx = await setup('/game.sgf', '/other.sgf');
  await comment(ctx, 'kept in the branch');
  await save(ctx);
  const first = deferred(),
    second = deferred(),
    selected = deferred();
  const releaseFirst = deferred(),
    releaseSecond = deferred();
  const write = ctx.files.saveAs;
  vi.spyOn(ctx.files, 'saveAs')
    .mockImplementationOnce(async (...args) => {
      first.resolve();
      await releaseFirst.promise;
      return write(...args);
    })
    .mockImplementationOnce(async (...args) => {
      second.resolve();
      await releaseSecond.promise;
      return write(...args);
    });
  const read = ctx.files.openRecent;
  ctx.files.openRecent = async (index) => {
    const result = await read(index);
    selected.resolve();
    return result;
  };
  const rpc = vi.spyOn(ctx.transport, 'request');
  const clean = saveClean(ctx);
  await first.promise;
  const opening = openRecent(ctx, 1);
  await selected.promise;
  const branch = saveBranch(ctx);
  releaseFirst.resolve();
  await second.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseSecond.resolve();
  await Promise.all([clean, branch, opening]);
  expect(ctx.files.written.get('/other.sgf')).toContain('C[kept in the branch]');
  expect(rpc.mock.calls.map(([r]) => r).find((r) => r.type === 'gameOpen')?.bytes).toBe(
    await ctx.files.reread('/other.sgf'),
  );
});
