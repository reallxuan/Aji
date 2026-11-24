import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import { RulesControl } from './RulesControl';

function show(value: AnalysisRules) {
  const onChange = vi.fn();
  const view = render(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <RulesControl value={value} onChange={onChange} />
    </I18nextProvider>,
  );
  return { onChange, ...view };
}

const custom = (komi: number, scoring: 'area' | 'territory' = 'area'): AnalysisRules => ({
  kind: 'custom',
  details: null,
  komi,
  scoring,
});

const chineseDetails = {
  ko: 'simple',
  tax: 'none',
  suicide: false,
  hasButton: false,
  whiteHandicapBonus: 'n',
  friendlyPassOk: true,
} as const;
const japaneseDetails = {
  ...chineseDetails,
  tax: 'seki',
  whiteHandicapBonus: 'zero',
  friendlyPassOk: false,
} as const;

it('chooses a preset, which shows its fixed komi and no stepper', () => {
  const { onChange } = show({ kind: 'chinese' });
  expect(screen.getByText('7.5 目')).toBeInTheDocument();
  expect(screen.getByText('数子，由规则决定')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '增加贴目' })).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: '日韩规则' }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'japaneseKorean' });
});

it('starts Custom from the preset it leaves', () => {
  const { onChange } = show({ kind: 'chinese' });
  fireEvent.click(screen.getByRole('radio', { name: '自定义' }));
  expect(onChange).toHaveBeenCalledWith({ ...custom(7.5, 'area'), details: chineseDetails });
  const japanese = show({ kind: 'japaneseKorean' });
  fireEvent.click(screen.getAllByRole('radio', { name: '自定义' })[1]);
  expect(japanese.onChange).toHaveBeenCalledWith({
    ...custom(6.5, 'territory'),
    details: japaneseDetails,
  });
});

it('steps the custom komi by 0.5 and clamps it at 150', () => {
  const { onChange, rerender } = show(custom(7));
  fireEvent.click(screen.getByRole('button', { name: '减少贴目' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...custom(6.5), details: chineseDetails });
  rerender(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <RulesControl value={custom(149.5)} onChange={onChange} />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '增加贴目' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...custom(150), details: chineseDetails });
  rerender(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <RulesControl value={custom(150)} onChange={onChange} />
    </I18nextProvider>,
  );
  expect(screen.getByRole('button', { name: '增加贴目' })).toBeDisabled();
});

it('takes a typed komi on Enter, and reverts an invalid one on blur', () => {
  const { onChange } = show(custom(7, 'territory'));
  const input = screen.getByRole('textbox', { name: '贴目' });
  fireEvent.change(input, { target: { value: '7.3' } });
  fireEvent.blur(input);
  expect(onChange).not.toHaveBeenCalled();
  expect(input).toHaveValue('7');
  fireEvent.change(input, { target: { value: '-5.5' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith({ ...custom(-5.5, 'territory'), details: japaneseDetails });
});

it('switches the custom scoring', () => {
  const { onChange } = show(custom(7, 'territory'));
  fireEvent.click(screen.getByRole('radio', { name: '数子' }));
  expect(onChange).toHaveBeenCalledWith({ ...custom(7, 'area'), details: japaneseDetails });
});

it('edits each custom field while retaining the full KataGo details', () => {
  const value = {
    kind: 'custom',
    komi: 0,
    scoring: 'territory',
    details: { ...japaneseDetails, friendlyPassOk: true },
  } as const;
  const { onChange } = show(value);
  for (const [label, patch] of [
    ['情境同形', { ko: 'situational' }],
    ['允许', { suicide: true }],
    ['全部', { tax: 'all' }],
    ['N-1', { whiteHandicapBonus: 'nMinusOne' }],
    ['有', { hasButton: true }],
  ] as const) {
    fireEvent.click(screen.getByRole('radio', { name: label }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      details: { ...value.details, ...patch },
    });
  }
});
