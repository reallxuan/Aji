import { describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import type { GameWarning } from '../transport/generated/GameWarning';
import { TransportError } from '../transport/transport';
import { cacheNotice, errorNotice, warningNotice } from './notices';
import { makeSnapshot } from './testing';

const zh = createI18n('zh-CN').t;
const en = createI18n('en').t;
const at183 = makeSnapshot({ lineLength: 183 });

describe('error notices', () => {
  it('name the board size that cannot be opened', () => {
    const error = new TransportError('sgfUnsupportedSize', 'SZ[19:13]', '19x13');
    expect(errorNotice('无法打开 大棋盘练习.sgf', error, zh)).toEqual({
      kind: 'error',
      title: '无法打开 大棋盘练习.sgf',
      detail: '不支持 19×13 的棋盘。Aji 支持 5 到 19 路的方形棋盘。',
    });
    expect(errorNotice('Cannot open big.sgf', error, en).detail).toBe(
      'A 19×13 board is not supported. Aji opens square boards from 5×5 to 19×19.',
    );
  });

  it.each([
    ['sgfNotAGame', '文件里没有棋谱。', 'The file holds no game record.'],
    ['sgfNotGo', '这不是围棋棋谱。', 'The file records a game other than Go.'],
    ['sgfTooLarge', '文件超过 20 MB。', 'The file is over 20 MB.'],
    ['fileReadFailed', '无法读取文件。', 'The file could not be read.'],
    ['fileWriteFailed', '无法保存文件。', 'The file could not be saved.'],
    ['fileNotSgf', '只能打开 .sgf 文件。', 'Only .sgf files can be opened.'],
    ['fileMissing', '文件已移动或删除。', 'The file has been moved or deleted.'],
  ] as const)('explain %s in both languages', (code, zhText, enText) => {
    const error = new TransportError(code, 'from the backend');
    expect(errorNotice('t', error, zh).detail).toBe(zhText);
    expect(errorNotice('t', error, en).detail).toBe(enText);
  });
});

describe('warning notices', () => {
  const one = (warning: GameWarning, t = zh) => warningNotice([warning], at183, t);

  it('say where a truncated record stops', () => {
    expect(one({ code: 'truncated' })).toEqual({
      kind: 'warning',
      title: '棋谱不完整，已打开前 183 手',
      detail: '文件在第 184 手处中断，可能没有下载完。',
    });
    expect(one({ code: 'truncated' }, en)).toEqual({
      kind: 'warning',
      title: 'The record is incomplete: opened the first 183 moves',
      detail: 'The file breaks off at move 184; it may not have finished downloading.',
    });
  });

  it('count every game in the file, the open one included', () => {
    expect(one({ code: 'extraGames', count: 11 })).toMatchObject({
      title: '这个文件里有 12 局棋，只打开了第一局',
      detail: '另存为时其余各局会原样保留。',
    });
    expect(one({ code: 'extraGames', count: 11 }, en)).toMatchObject({
      title: 'This file holds 12 games; only the first is open',
      detail: 'Save as keeps the others as they are.',
    });
  });

  it('name a guessed encoding', () => {
    expect(one({ code: 'encodingGuessed', encoding: 'GBK' })).toMatchObject({
      title: '棋谱未注明编码，已按 GBK 读取',
      detail: '如果名字显示不对，请告诉我们。',
    });
    expect(one({ code: 'encodingGuessed', encoding: 'GBK' }, en)?.title).toBe(
      'The record names no encoding: read as GBK',
    );
  });

  it.each(['repaired', 'illegalMoves', 'komiUnreadable'] as const)(
    'give %s a title and a detail in both languages',
    (code) => {
      for (const t of [zh, en]) {
        const notice = one({ code }, t);
        expect(notice?.title).toBeTruthy();
        expect(notice?.detail).toBeTruthy();
        expect(notice?.title).not.toContain('notice.');
        expect(notice?.detail).not.toContain('notice.');
      }
    },
  );

  it('lead with the most important and list the others under it', () => {
    const notice = warningNotice(
      [
        { code: 'encodingGuessed', encoding: 'GBK' },
        { code: 'extraGames', count: 2 },
      ],
      at183,
      zh,
    );
    expect(notice).toEqual({
      kind: 'warning',
      title: '这个文件里有 3 局棋，只打开了第一局',
      detail: '另存为时其余各局会原样保留。\n棋谱未注明编码，已按 GBK 读取',
    });
  });

  it('are nothing without warnings', () => {
    expect(warningNotice([], at183, zh)).toBeNull();
  });
});

describe('the cache notice', () => {
  const t = createI18n('zh-CN').t;
  const stats = { usedBytes: 0, capBytes: 1024 ** 3, persistent: true, reason: null };

  it('says nothing while the cache file is in use', () => {
    expect(cacheNotice(stats, t)).toBeNull();
  });

  it('says results are not kept when the file cannot be used', () => {
    expect(cacheNotice({ ...stats, persistent: false, reason: 'disk I/O error' }, t)).toEqual({
      kind: 'warning',
      title: '分析结果不会保留',
      detail: '缓存文件无法使用，结果只保留到 Aji 退出。',
    });
  });
});
