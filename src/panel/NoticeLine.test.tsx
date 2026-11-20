import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetNotices, useNoticeStore, WARNING_MS } from '../game/noticeStore';
import { createI18n } from '../i18n/createI18n';
import { NoticeLine } from './NoticeLine';

const show = useNoticeStore.getState().show;

function mount(language: 'zh-CN' | 'en' = 'zh-CN') {
  return render(
    <I18nextProvider i18n={createI18n(language)}>
      <button type="button">elsewhere</button>
      <NoticeLine />
    </I18nextProvider>,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  resetNotices();
  vi.useRealTimers();
});

it('shows nothing without a notice', () => {
  const { container } = mount();
  expect(container.querySelector('[data-notice]')).toBeNull();
});

it('shows an error with its title and detail until closed', () => {
  mount();
  act(() =>
    show({ kind: 'error', title: '无法打开 大棋盘练习.sgf', detail: '不支持 21×21 的棋盘。' }),
  );
  const notice = screen.getByRole('alert');
  expect(notice).toHaveAttribute('data-notice', 'error');
  expect(notice).toHaveTextContent('无法打开 大棋盘练习.sgf');
  expect(notice).toHaveTextContent('不支持 21×21 的棋盘。');
  act(() => vi.advanceTimersByTime(WARNING_MS * 2));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('fades a warning after six seconds', () => {
  mount('en');
  act(() => show({ kind: 'warning', title: 'The record is incomplete' }));
  expect(screen.getByRole('status')).toHaveTextContent('The record is incomplete');
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(WARNING_MS - 1));
  expect(screen.getByRole('status')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole('status')).toBeNull();
});

it('replaces one notice with the next', () => {
  mount();
  act(() => show({ kind: 'error', title: '第一条' }));
  act(() => show({ kind: 'warning', title: '第二条' }));
  expect(screen.queryByText('第一条')).toBeNull();
  expect(screen.getByText('第二条')).toBeInTheDocument();
});

it('leaves the keyboard focus where it was', () => {
  mount();
  screen.getByRole('button', { name: 'elsewhere' }).focus();
  act(() => show({ kind: 'error', title: '无法保存棋谱' }));
  expect(screen.getByRole('button', { name: 'elsewhere' })).toHaveFocus();
});

it('keeps each detail line on its own line', () => {
  mount();
  act(() => show({ kind: 'warning', title: 't', detail: 'one\ntwo' }));
  expect(screen.getByText(/one/)).toHaveClass('whitespace-pre-line');
});
