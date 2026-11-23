import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import { RulesChip } from './RulesChip';

afterEach(() => resetGameStore());

const withRules = (current: AnalysisRules, changed = false) =>
  makeSnapshot({ rules: { current, fromFile: current, changed, ru: null, km: null } });

it.each([
  [{ kind: 'chinese' } as AnalysisRules, '中国 7.5'],
  [{ kind: 'japaneseKorean' } as AnalysisRules, '日韩 6.5'],
  [{ kind: 'custom', komi: 7, scoring: 'territory' } as AnalysisRules, '自定义 7'],
  [{ kind: 'custom', komi: -0.5, scoring: 'area' } as AnalysisRules, '自定义 -0.5'],
])('labels %j as %s', (rules, label) => {
  renderWithGame(<RulesChip />, { snapshot: withRules(rules) });
  expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
});

it('shows the amber dot only when the rules were changed', () => {
  const { unmount } = renderWithGame(<RulesChip />, { snapshot: withRules({ kind: 'chinese' }) });
  expect(document.querySelector('[data-changed-dot]')).toBeNull();
  unmount();
  resetGameStore();
  renderWithGame(<RulesChip />, { snapshot: withRules({ kind: 'chinese' }, true) });
  expect(document.querySelector('[data-changed-dot]')).not.toBeNull();
  expect(screen.getByRole('button', { name: /已改动/ })).toBeInTheDocument();
});

it('opens the game information popover', () => {
  renderWithGame(<RulesChip />, { snapshot: withRules({ kind: 'chinese' }) });
  fireEvent.click(screen.getByRole('button', { name: '中国 7.5' }));
  expect(screen.getByText('分析规则')).toBeInTheDocument();
});

it('keeps a komi-only form for a narrow panel, under the full name', () => {
  renderWithGame(<RulesChip />, {
    snapshot: withRules({ kind: 'custom', komi: 7, scoring: 'area' }),
  });
  // The header's container query shows one or the other; both carry the komi.
  expect(document.querySelector('[data-compact]')).toHaveTextContent(/^7$/);
  expect(screen.getByRole('button', { name: '自定义 7' })).toHaveTextContent('自定义 7');
});
