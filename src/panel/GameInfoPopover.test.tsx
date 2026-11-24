import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot, noInfo } from '../game/testing';
import type { RulesState } from '../transport/generated/RulesState';
import { flushRecordFields } from '../game/fieldWrites';
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
  expect(screen.getByLabelText('黑方')).toHaveValue('丁浩');
  expect(screen.getByLabelText('白方段位')).toHaveValue('九段');
  expect(screen.getByLabelText('结果')).toHaveValue('white');
  expect(screen.getByLabelText('胜法')).toHaveValue('resign');
  expect(screen.getByLabelText('赛事')).toHaveValue('第30届三星杯决赛');
  expect(screen.getByLabelText('轮次')).toHaveValue('第2局');
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
  expect(requests).toContainEqual({ type: 'gameEdit', edit: { kind: 'setRules', rules: null } });
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
  expect(requests).toContainEqual({
    type: 'gameEdit',
    edit: { kind: 'setRules', rules: { kind: 'chinese' } },
  });
});

it('keeps an unknown RE as text until the user replaces it', async () => {
  const { requests } = renderWithGame(<GameInfoContent />, {
    snapshot: makeSnapshot({ info: { ...noInfo, result: 'Void (review)' } }),
  });
  expect(screen.getByText('Void (review)')).toBeInTheDocument();
  await act(async () =>
    fireEvent.change(screen.getByLabelText('结果'), { target: { value: 'draw' } }),
  );
  expect(requests).toContainEqual({
    type: 'gameEdit',
    edit: { kind: 'setInfo', field: 'result', value: '0' },
  });
});

it('commits once on Enter and blur, keeps newer typing through an older reply and flushes it', async () => {
  let release!: () => void;
  const slow = new Promise<void>((r) => {
    release = r;
  });
  let revision = 1;
  const { requests, transport } = renderWithGame(<GameInfoContent />, {
    answer: (req) => {
      if (req.type !== 'gameEdit' || req.edit.kind !== 'setInfo') return;
      const name = req.edit.value;
      return slow.then(() => ({
        type: 'game',
        warnings: [],
        snapshot: makeSnapshot({ revision: ++revision, info: { ...noInfo, gameName: name } }),
      }));
    },
  });
  const input = screen.getByLabelText('棋局名称');
  fireEvent.change(input, { target: { value: 'One' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: 'Two' } });
  await act(async () => {
    release();
    await slow;
  });
  expect(input).toHaveValue('Two');
  await act(async () => expect(await flushRecordFields(transport)).toBe(true));
  expect(requests.filter((r) => r.type === 'gameEdit').map((r) => r.edit)).toEqual([
    { kind: 'setInfo', field: 'gameName', value: 'One' },
    { kind: 'setInfo', field: 'gameName', value: 'Two' },
  ]);
});
it('disables info, rules and restore during try-out', () => {
  renderWithGame(<GameInfoContent />, {
    snapshot: makeSnapshot({
      tryout: 0,
      rules: { current: custom, fromFile: japanese, changed: true, ru: null, km: null },
    }),
  });
  for (const control of [
    screen.getByLabelText('黑方'),
    screen.getByRole('radio', { name: '中国规则' }),
    screen.getByRole('button', { name: '恢复棋谱设定' }),
  ])
    expect(control).toBeDisabled();
  expect(useGameStore.getState().snapshot?.tryout).toBe(0);
});
