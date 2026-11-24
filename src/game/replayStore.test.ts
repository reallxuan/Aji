import { edit, undo, redo } from './editActions';
import { useDeviceStore } from '../device/deviceStore';
import { afterEach, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { createFakeTransport } from '../transport/fake';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { connectReplay, navigate, openRecent, startNewGame } from './actions';
import { bindReplay, useReplayStore } from './replayStore';
import { resetGameStore, useGameStore } from './gameStore';
import { makeSnapshot } from './testing';

function setup(answer: (r: Request) => Promise<Response> | Response) {
  vi.useFakeTimers();
  const requests: Request[] = [];
  const ctx = {
    transport: createFakeTransport((r) => {
      requests.push(r);
      return answer(r);
    }),
    files: createFakeFiles(),
    t: createI18n('en').t,
  };
  useGameStore.getState().apply(makeSnapshot({ atEnd: false }));
  connectReplay(ctx);
  useReplayStore.getState().start();
  return { ctx, requests };
}
afterEach(() => {
  bindReplay(null);
  resetGameStore();
  vi.useRealTimers();
});
const game = (revision: number, atEnd: boolean): Response => ({
  type: 'game',
  snapshot: makeSnapshot({ revision, node: revision, lineIndex: revision - 1, atEnd }),
  warnings: [],
});

it('replay stops on navigation and at the end', async () => {
  const { ctx, requests } = setup(() => game(2, true));
  await vi.advanceTimersByTimeAsync(1499);
  expect(requests).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests).toEqual([{ type: 'gameNavigate', to: 'next' }]);
  expect(useReplayStore.getState().playing).toBe(false);
  useGameStore.getState().apply(makeSnapshot({ revision: 3, atEnd: false }));
  useReplayStore.getState().start();
  await navigate(ctx, 'first');
  await vi.advanceTimersByTimeAsync(9000);
  expect(requests).toHaveLength(2);
  expect(useReplayStore.getState().playing).toBe(false);
});

it('a slow replay step finishes before the new-game revision is checked, with no trailing ticks', async () => {
  let finish!: (reply: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const { ctx, requests } = setup((r) => (r.type === 'gameNavigate' ? pending : game(3, true)));
  await vi.advanceTimersByTimeAsync(7500);
  expect(requests).toHaveLength(1);
  const leaving = startNewGame(ctx, 9);
  await vi.advanceTimersByTimeAsync(1500);
  expect(requests).toHaveLength(1);
  finish(game(2, false));
  await leaving;
  await vi.advanceTimersByTimeAsync(9000);
  expect(requests).toEqual([
    { type: 'gameNavigate', to: 'next' },
    { type: 'gameNew', size: 9, expectedRevision: 2 },
  ]);
});

it('honours the saved interval and stops as soon as an edit is requested', async () => {
  useDeviceStore.getState().update({ autoReplaySeconds: 0.4 });
  let revision = 1;
  const { ctx, requests } = setup(() => game(++revision, false));
  await vi.advanceTimersByTimeAsync(800);
  expect(requests).toHaveLength(2);
  const edited = edit(ctx, { kind: 'pass' });
  expect(useReplayStore.getState().playing).toBe(false);
  await edited;
  await vi.advanceTimersByTimeAsync(2000);
  expect(requests.at(-1)).toEqual({ type: 'gameEdit', edit: { kind: 'pass' } });
});

it('requesting a recent file stops replay before the recent list arrives', async () => {
  const { ctx, requests } = setup(() => game(2, false));
  let finish!: () => void;
  ctx.files.recent = () =>
    new Promise((resolve) => {
      finish = () => resolve([]);
    });
  const leaving = openRecent(ctx, 0);
  await vi.advanceTimersByTimeAsync(1600);
  finish();
  await leaving;
  expect(requests).toHaveLength(0);
  expect(useReplayStore.getState().playing).toBe(false);
});

it('a pushed edit on the same node interrupts replay before the next tick', async () => {
  const { requests } = setup(() => game(3, false));
  useGameStore
    .getState()
    .apply(makeSnapshot({ revision: 2, atEnd: false, comment: 'changed remotely', changed: true }));
  await vi.advanceTimersByTimeAsync(1500);
  expect(requests).toHaveLength(0);
  expect(useReplayStore.getState().playing).toBe(false);
});

it.each(['edit', 'undo', 'redo', 'previous'] as const)(
  'a pending replay step invalidates %s requested from the previous visit',
  async (action) => {
    let deliver!: (r: Response) => void;
    const pending = new Promise<Response>((r) => {
      deliver = r;
    });
    const { ctx, requests } = setup((r) =>
      r.type === 'gameNavigate' && r.to === 'next' ? pending : game(3, false),
    );
    await vi.advanceTimersByTimeAsync(1500);
    const requested =
      action === 'edit'
        ? edit(ctx, { kind: 'pass' })
        : action === 'undo'
          ? undo(ctx)
          : action === 'redo'
            ? redo(ctx)
            : navigate(ctx, 'previous');
    try {
      expect(requests).toEqual([{ type: 'gameNavigate', to: 'next' }]);
    } finally {
      deliver(game(2, false));
      await requested;
    }
    expect(requests).toEqual([{ type: 'gameNavigate', to: 'next' }]);
    expect(useGameStore.getState().snapshot?.node).toBe(2);
  },
);

it('honours an edit on a replay visit already displayed via a snapshot event', async () => {
  let deliver!: (r: Response) => void;
  const pending = new Promise<Response>((r) => {
    deliver = r;
  });
  const { ctx, requests } = setup((r) => (r.type === 'gameNavigate' ? pending : game(3, false)));
  await vi.advanceTimersByTimeAsync(1500);
  const reply = {
    type: 'game' as const,
    snapshot: makeSnapshot({ revision: 2, node: 2, lineIndex: 1, atEnd: false }),
    warnings: [],
  };
  useGameStore.getState().apply(reply.snapshot);
  const edited = edit(ctx, { kind: 'pass' });
  try {
    expect(requests).toHaveLength(1);
  } finally {
    deliver(reply);
    await edited;
  }
  expect(requests).toEqual([
    { type: 'gameNavigate', to: 'next' },
    { type: 'gameEdit', edit: { kind: 'pass' } },
  ]);
});

it('two edits queued for an early replay snapshot cannot both move away from the same visit', async () => {
  let deliver!: (r: Response) => void;
  let finishEdit!: (r: Response) => void;
  const tick = new Promise<Response>((r) => {
    deliver = r;
  });
  const first = new Promise<Response>((r) => {
    finishEdit = r;
  });
  const { ctx, requests } = setup((r) => (r.type === 'gameNavigate' ? tick : first));
  await vi.advanceTimersByTimeAsync(1500);
  const reply = game(2, false);
  if (reply.type !== 'game') throw Error('expected a game');
  useGameStore.getState().apply(reply.snapshot);
  const one = edit(ctx, { kind: 'pass' }),
    two = edit(ctx, { kind: 'pass' });
  deliver(reply);
  await vi.advanceTimersByTimeAsync(0);
  try {
    expect(requests.filter((r) => r.type === 'gameEdit')).toHaveLength(1);
  } finally {
    finishEdit(game(3, false));
    await Promise.all([one, two]);
  }
  expect(requests.filter((r) => r.type === 'gameEdit')).toHaveLength(1);
});
