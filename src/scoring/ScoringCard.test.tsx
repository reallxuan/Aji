import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { Request } from '../transport/generated/Request';
import type { ScoreView } from '../transport/generated/ScoreView';
import { ScoringCard } from './ScoringCard';
import { resetScoringStore, useScoringStore } from './scoringStore';
import { C5, H4 } from './testing';

afterEach(() => {
  resetScoringStore();
  resetGameStore();
});

/** The mockup's game counted with C5 and H4 dead: White wins by 8.5 either way. */
const AREA: ScoreView = {
  suggestedDead: [C5, H4],
  black: { stones: 13, territory: 26, dead: 1, prisoners: 2, total: 40 },
  white: { stones: 13, territory: 27, dead: 1, prisoners: 3, total: 48.5 },
  komi: 7.5,
  margin: -8.5,
  owners: [],
  openByOwnership: false,
};
// A dead stone counts as its point and as a prisoner: 地 27 + 死子 1 + 提子 2 = 30.
const TERRITORY: ScoreView = {
  ...AREA,
  black: { ...AREA.black, total: 30 },
  white: { ...AREA.white, total: 38.5 },
  komi: 6.5,
};

function mount(rules: AnalysisRules, score: ScoreView | null, language: 'zh-CN' | 'en' = 'zh-CN') {
  const snapshot = makeSnapshot({
    size: 9,
    rules: { current: rules, fromFile: rules, changed: false, ru: null, km: null },
  });
  useScoringStore.setState({ active: true, dead: [C5, H4], suggested: [C5, H4], score });
  return renderWithGame(<ScoringCard />, {
    snapshot,
    language,
    answer: (request: Request) =>
      request.type === 'gameScore'
        ? { type: 'score', ...AREA }
        : request.type === 'analysisResume'
          ? { type: 'ok' }
          : undefined,
  });
}

const rows = () =>
  screen
    .getAllByRole('row')
    .map((row) => [...row.querySelectorAll('th, td')].map((c) => c.textContent));

it('area rules count stones and territory', () => {
  mount({ kind: 'chinese' }, AREA);
  const card = screen.getByTestId('scoring-card');
  expect(card).toHaveTextContent('终局点目');
  expect(card).toHaveTextContent('中国规则，数子');
  expect(rows()).toEqual([
    ['数子', '棋子', '地', '贴目', '合计'],
    ['黑', '13', '27', '', '40'],
    ['白', '13', '28', '7.5', '48.5'],
  ]);
  expect(card).toHaveTextContent('白胜 8.5 目');
  expect(card).toHaveTextContent('死子是 KataGo 判断的。');
  expect(card).not.toHaveTextContent('已改动');
});

it('territory_rules_show_territory_columns', () => {
  mount({ kind: 'japaneseKorean' }, TERRITORY);
  expect(screen.getByTestId('scoring-card')).toHaveTextContent('日韩规则，数目');
  expect(rows()).toEqual([
    ['数目', '地', '死子', '提子', '贴目', '合计'],
    ['黑', '27', '1', '2', '', '30'],
    ['白', '28', '1', '3', '6.5', '38.5'],
  ]);
});

it('custom rules follow their scoring', () => {
  mount({ kind: 'custom', komi: 0.5, scoring: 'territory' }, { ...TERRITORY, komi: 0.5 });
  expect(screen.getByTestId('scoring-card')).toHaveTextContent('自定义规则，数目');
  expect(rows()[0]).toHaveLength(6);
});

it('reads a win and a draw', () => {
  mount({ kind: 'chinese' }, { ...AREA, margin: 3 });
  expect(screen.getByTestId('scoring-card')).toHaveTextContent('黑胜 3 目');
  act(() => useScoringStore.setState({ score: { ...AREA, margin: 0 } }));
  expect(screen.getByTestId('scoring-card')).toHaveTextContent('和棋');
});

it('waits for the count', () => {
  mount({ kind: 'chinese' }, null);
  expect(screen.getByTestId('scoring-card')).toHaveTextContent('正在点目');
  expect(screen.queryByRole('table')).toBeNull();
});

it('a failed count says so and keeps the way out', () => {
  mount({ kind: 'chinese' }, null);
  act(() => useScoringStore.setState({ failed: true }));
  expect(screen.getByTestId('scoring-card')).toHaveTextContent('无法点目');
  expect(screen.getByTestId('scoring-card')).not.toHaveTextContent('正在点目');
  expect(screen.getByRole('button', { name: '退出点目' })).toBeInTheDocument();
  // A recount that fails after a toggle: the last count stays, marked as out of date.
  act(() => useScoringStore.setState({ score: AREA }));
  expect(screen.getByTestId('scoring-card')).toHaveTextContent('白胜 8.5 目');
  expect(screen.getByTestId('scoring-card')).toHaveTextContent('无法点目');
});

it('changed_marking_offers_reset', async () => {
  const { requests } = mount({ kind: 'chinese' }, AREA);
  act(() => useScoringStore.setState({ dead: [C5] }));
  const card = screen.getByTestId('scoring-card');
  expect(card).toHaveTextContent('已改动');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '恢复 KataGo 的判断' }));
  });
  expect(requests.at(-1)).toEqual({ type: 'gameScore', mode: { kind: 'final', dead: [C5, H4] } });
  expect(card).not.toHaveTextContent('已改动');
});

it('an_unfinished_game_says_open_areas_follow_katago', () => {
  mount({ kind: 'japaneseKorean' }, TERRITORY);
  const card = screen.getByTestId('scoring-card');
  expect(card).not.toHaveTextContent('未封闭');
  act(() => useScoringStore.setState({ score: { ...TERRITORY, openByOwnership: true } }));
  expect(card).toHaveTextContent('棋局未下完，未封闭的区域按 KataGo 判断。');
});

it('says so in English too', () => {
  mount({ kind: 'japaneseKorean' }, { ...TERRITORY, openByOwnership: true }, 'en');
  expect(screen.getByTestId('scoring-card')).toHaveTextContent(
    "The game was not played out, so open areas follow KataGo's judgement.",
  );
});

it('leaves scoring', async () => {
  mount({ kind: 'chinese' }, AREA);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '退出点目' }));
  });
  expect(useScoringStore.getState().active).toBe(false);
});

it('reads in English', () => {
  mount({ kind: 'chinese' }, AREA, 'en');
  const card = screen.getByTestId('scoring-card');
  expect(card).toHaveTextContent('Final Scoring');
  expect(card).toHaveTextContent('Chinese rules, area scoring');
  // The hint's two sentences stand apart.
  expect(card.querySelector('span.mr-1')).toHaveTextContent(/alive\.$/);
  expect(card).toHaveTextContent('White wins by 8.5');
});
