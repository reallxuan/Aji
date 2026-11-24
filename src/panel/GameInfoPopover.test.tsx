import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot, noInfo } from '../game/testing';
import type { RulesState } from '../transport/generated/RulesState';
import { GameInfoContent } from './GameInfoPopover';

afterEach(() => resetGameStore());

const japanese = { kind: 'japaneseKorean' } as const;
const custom = { kind: 'custom', details: null, komi: 7, scoring: 'territory' } as const;

function show(rules: RulesState) {
  const info = {
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
  return renderWithGame(<GameInfoContent />, {
    snapshot: makeSnapshot({ info, rules, name: 'samsung' }),
  });
}

it('shows the players, result, date and event', () => {
  show({ current: japanese, fromFile: japanese, changed: false, ru: null, km: '6.5' });
  expect(screen.getByText('丁浩')).toBeInTheDocument();
  expect(screen.getAllByText('九段')).toHaveLength(2);
  expect(screen.getByText('W+R')).toBeInTheDocument();
  expect(screen.getByText('第30届三星杯决赛 第2局')).toBeInTheDocument();
});

it('says the rules match the file, naming what it records', () => {
  show({ current: japanese, fromFile: japanese, changed: false, ru: null, km: '6.5' });
  const source = screen.getByTestId('rules-source');
  expect(source).toHaveTextContent('与棋谱一致：棋谱记载 KM[6.5]，按日韩规则读取。');
  expect(screen.queryByRole('button', { name: '恢复棋谱设定' })).toBeNull();
});

it('says what changed and restores the file reading', () => {
  const { requests } = show({
    current: custom,
    fromFile: japanese,
    changed: true,
    ru: 'Japanese',
    km: '0',
  });
  const source = screen.getByTestId('rules-source');
  expect(source).toHaveTextContent('已改动。棋谱记载 RU[Japanese] KM[0]，原按日韩规则读取。');
  fireEvent.click(screen.getByRole('button', { name: '恢复棋谱设定' }));
  expect(requests).toContainEqual({ type: 'gameSetRules', rules: null });
});

it('says when the file has neither rules nor komi', () => {
  show({ current: japanese, fromFile: japanese, changed: false, ru: null, km: null });
  expect(screen.getByTestId('rules-source')).toHaveTextContent(
    '棋谱没有写规则或贴目，使用默认设置。',
  );
});

it('sends a rules change for this game', () => {
  const { requests } = show({
    current: japanese,
    fromFile: japanese,
    changed: false,
    ru: null,
    km: '6.5',
  });
  fireEvent.click(screen.getByRole('radio', { name: '中国规则' }));
  expect(requests).toContainEqual({ type: 'gameSetRules', rules: { kind: 'chinese' } });
});
