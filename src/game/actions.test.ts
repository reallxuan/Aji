import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { createFakeTransport } from '../transport/fake';
import type { GameWarning } from '../transport/generated/GameWarning';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { TransportError } from '../transport/transport';
import { navigate, openDropped, openFromPicker, openRecent, saveAs, startNewGame } from './actions';
import { resetGameStore, useGameStore } from './gameStore';
import { resetNotices, useNoticeStore } from './noticeStore';
import { makeSnapshot, noInfo } from './testing';

const t = createI18n('zh-CN').t;
const samsung = makeSnapshot({
  revision: 3,
  name: 'samsung',
  info: { ...noInfo, black: '丁浩', white: '廖元赫' },
  hasMoves: true,
  lineLength: 183,
});

function setup(
  handler: (request: Request) => Response | Promise<Response>,
  files: Parameters<typeof createFakeFiles>[0] = {},
) {
  const requests: Request[] = [];
  const transport = createFakeTransport((request) => {
    requests.push(request);
    return handler(request);
  });
  const fake = createFakeFiles(files);
  return { ctx: { transport, files: fake, t }, files: fake, requests };
}

const opened = (warnings: GameWarning[] = []): Response => ({
  type: 'game',
  snapshot: samsung,
  warnings,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
  resetNotices();
});

describe('opening', () => {
  it('remembers a file only after gameOpen succeeds, under the composed title', async () => {
    const { ctx, files, requests } = setup(() => opened(), {
      files: { '/games/samsung.sgf': '(;B[pd])' },
      pick: '/games/samsung.sgf',
    });
    await openFromPicker(ctx);
    expect(requests[0]).toMatchObject({ type: 'gameOpen', name: 'samsung.sgf' });
    expect(useGameStore.getState().snapshot?.name).toBe('samsung');
    expect(files.remembered).toEqual([{ path: '/games/samsung.sgf', title: '丁浩 对 廖元赫' }]);
    expect(useNoticeStore.getState().notice).toBeNull();
  });

  it('shows the error with the file name and does not remember a failed open', async () => {
    const { ctx, files } = setup(
      () => {
        throw new TransportError('sgfNotGo', 'GM[2]');
      },
      { files: { '/games/chess.sgf': '(;GM[2])' }, pick: '/games/chess.sgf' },
    );
    await openFromPicker(ctx);
    expect(files.remembered).toEqual([]);
    const notice = useNoticeStore.getState().notice;
    expect(notice).toMatchObject({ kind: 'error', title: '无法打开 chess.sgf' });
    expect(notice?.detail).toBe('这不是围棋棋谱。');
  });

  it('puts the board size into the unsupported-size text', async () => {
    const { ctx } = setup(
      () => {
        throw new TransportError('sgfUnsupportedSize', '19x13', '19x13');
      },
      { files: { '/a.sgf': '(;SZ[19:13])' }, pick: '/a.sgf' },
    );
    await openFromPicker(ctx);
    expect(useNoticeStore.getState().notice?.detail).toContain('19×13');
  });

  it('does nothing when the dialog is cancelled', async () => {
    const { ctx, requests } = setup(() => opened(), { pick: null });
    await openFromPicker(ctx);
    expect(requests).toEqual([]);
    expect(useNoticeStore.getState().notice).toBeNull();
  });

  it('shows one warning, the most important first, and lets it fade after 6 s', async () => {
    const { ctx } = setup(
      () =>
        opened([
          { code: 'encodingGuessed', encoding: 'GBK' },
          { code: 'extraGames', count: 2 },
          { code: 'truncated' },
        ]),
      { files: { '/a.sgf': '(;' }, pick: '/a.sgf' },
    );
    await openFromPicker(ctx);
    const notice = useNoticeStore.getState().notice;
    expect(notice?.kind).toBe('warning');
    expect(notice?.title).toBe('棋谱不完整，已打开前 183 手');
    expect(notice?.detail).toContain('GBK');
    vi.advanceTimersByTime(6000);
    expect(useNoticeStore.getState().notice).toBeNull();
  });

  it('orders extra games before a guessed encoding', async () => {
    const { ctx } = setup(
      () =>
        opened([
          { code: 'encodingGuessed', encoding: 'GBK' },
          { code: 'extraGames', count: 2 },
        ]),
      { files: { '/a.sgf': '(;' }, pick: '/a.sgf' },
    );
    await openFromPicker(ctx);
    // Two more games besides the open one: three in the file.
    expect(useNoticeStore.getState().notice?.title).toBe('这个文件里有 3 局棋，只打开了第一局');
  });

  it('refuses a dropped file that is not .sgf without reading it', async () => {
    const { ctx, requests } = setup(() => opened(), { files: { '/notes/a.txt': 'x' } });
    await openDropped(ctx, ['/notes/a.txt']);
    expect(requests).toEqual([]);
    expect(useNoticeStore.getState().notice).toMatchObject({
      kind: 'error',
      title: '无法打开 a.txt',
      detail: '只能打开 .sgf 文件。',
    });
  });

  it('opens the first dropped file', async () => {
    const { ctx, files } = setup(() => opened(), {
      files: { '/a.sgf': '(;)', '/b.sgf': '(;)' },
    });
    await openDropped(ctx, ['/a.sgf', '/b.sgf']);
    expect(files.remembered.map((r) => r.path)).toEqual(['/a.sgf']);
  });

  it('shows a missing recent file', async () => {
    const { ctx, files } = setup(() => opened(), { recent: ['/gone.sgf'] });
    await openRecent(ctx, 0);
    expect(useNoticeStore.getState().notice).toMatchObject({
      kind: 'error',
      detail: '文件已移动或删除。',
    });
    expect(await files.recent()).toEqual([]);
  });
});

describe('saving', () => {
  it('exports, writes under the title and remembers the saved file', async () => {
    useGameStore.getState().apply(samsung);
    const { ctx, files, requests } = setup(
      (request) =>
        request.type === 'gameExport'
          ? {
              type: 'gameExport',
              name: 'samsung.sgf',
              text: '(;GM[1])\n',
              bytes: null,
              editId: 7,
              fellBack: false,
            }
          : opened(),
      { savePath: '/out/丁浩 对 廖元赫.sgf' },
    );
    await saveAs(ctx);
    expect(requests).toEqual([
      { type: 'gameExport', options: { scope: 'game', clean: false, inPlace: false } },
      { type: 'gameSaved', editId: 7, utf8: true },
    ]);
    expect(files.saveRequests).toEqual(['丁浩 对 廖元赫.sgf']);
    expect(files.written.get('/out/丁浩 对 廖元赫.sgf')).toBe('(;GM[1])\n');
    expect(files.remembered).toEqual([
      { path: '/out/丁浩 对 廖元赫.sgf', title: '丁浩 对 廖元赫' },
    ]);
  });

  it('does nothing when the save dialog is cancelled', async () => {
    useGameStore.getState().apply(samsung);
    const { ctx, files, requests } = setup(
      () => ({
        type: 'gameExport',
        name: 'a.sgf',
        text: '(;)',
        bytes: null,
        editId: 0,
        fellBack: false,
      }),
      {
        savePath: null,
      },
    );
    await saveAs(ctx);
    expect(requests.map((request) => request.type)).toEqual(['gameExport']);
    expect(files.written.size).toBe(0);
    expect(files.remembered).toEqual([]);
    expect(useNoticeStore.getState().notice).toBeNull();
  });

  it('shows why an empty game cannot be saved', async () => {
    const { ctx } = setup(() => {
      throw new TransportError('gameEmpty', 'empty');
    });
    await saveAs(ctx);
    expect(useNoticeStore.getState().notice).toMatchObject({ kind: 'error' });
  });
});

describe('game requests', () => {
  it('applies the snapshot a new game or a navigation returns', async () => {
    const { ctx, requests } = setup(() => ({
      type: 'game',
      snapshot: makeSnapshot({ revision: requests.length + 10, size: 9 }),
      warnings: [],
    }));
    await startNewGame(ctx, 9);
    expect(requests[0]).toEqual({ type: 'gameNew', size: 9 });
    await navigate(ctx, { move: 12 });
    expect(requests[1]).toEqual({ type: 'gameNavigate', to: { move: 12 } });
    expect(useGameStore.getState().snapshot?.revision).toBe(12);
  });
});

it('routes rules edits through the same refusal notice as the other edits', async () => {
  const { setRules } = await import('./actions');
  const { ctx } = setup(() => {
    throw new TransportError('gameEndTryoutFirst', 'end try-out first');
  });
  await setRules(ctx, { kind: 'japaneseKorean' });
  expect(useNoticeStore.getState().notice?.title).toBe('先结束试下');
});
