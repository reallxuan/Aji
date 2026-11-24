import { describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { fileNameFor, gameTitle, windowTitle } from './title';
import { makeSnapshot, noInfo } from './testing';

describe.each([
  ['zh-CN', '丁浩 对 廖元赫', '未命名棋局'],
  ['en', '丁浩 vs 廖元赫', 'Untitled game'],
] as const)('gameTitle in %s', (language, players, untitled) => {
  const t = createI18n(language).t;
  const info = {
    ...noInfo,
    gameName: '决赛第二局',
    event: '第30届三星杯决赛',
    round: '第2局',
    black: '丁浩',
    white: '廖元赫',
  };

  it('uses GN, then event and round, then the players, then the file name, then untitled', () => {
    expect(gameTitle(makeSnapshot({ info, name: 'f' }), t)).toBe('决赛第二局');
    const noName = { ...info, gameName: null };
    expect(gameTitle(makeSnapshot({ info: noName, name: 'f' }), t)).toBe('第30届三星杯决赛 第2局');
    const noEvent = { ...noName, event: null, round: null };
    expect(gameTitle(makeSnapshot({ info: noEvent, name: 'f' }), t)).toBe(players);
    expect(gameTitle(makeSnapshot({ info: noInfo, name: 'samsung' }), t)).toBe('samsung');
    expect(gameTitle(makeSnapshot({ info: noInfo, name: null }), t)).toBe(untitled);
  });

  it('uses the event alone when there is no round', () => {
    const event = { ...noInfo, event: '名人戦' };
    expect(gameTitle(makeSnapshot({ info: event }), t)).toBe('名人戦');
  });

  it('titles the window Aji alone for a new empty game', () => {
    expect(windowTitle(null, t)).toBe('Aji');
    expect(windowTitle(makeSnapshot(), t)).toBe('Aji');
    expect(windowTitle(makeSnapshot({ name: 'samsung' }), t)).toBe('Aji — samsung');
  });
});

it('makes a file name from a title', () => {
  expect(fileNameFor('丁浩 vs 廖元赫')).toBe('丁浩 vs 廖元赫.sgf');
  expect(fileNameFor('a/b:c*?"<>|d')).toBe('a_b_c______d.sgf');
  expect(fileNameFor('  ')).toBe('game.sgf');
});

it('marks a modified window title, including an unnamed empty record', () => {
  const t = createI18n('zh-CN').t;
  expect(windowTitle(makeSnapshot({ changed: true }), t)).toBe('Aji (已修改)');
  expect(windowTitle(makeSnapshot({ changed: true, name: 'Cup' }), t)).toBe('Aji — Cup (已修改)');
});
