import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetViewStore, useViewStore } from '../analysis/viewStore';
import { useKeyDispatcher } from '../commands/useKeyDispatcher';
import { renderWithGame } from '../game/renderWithGame';
import { EyeButton } from './EyeButton';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }));
afterEach(() => {
  vi.useRealTimers();
  resetViewStore();
});

function Harness() {
  // The dispatcher registers the command context the button's commands run in.
  useKeyDispatcher(true);
  return <EyeButton />;
}

const view = () => useViewStore.getState();
const press = (el: HTMLElement) =>
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', button: 0 });
const release = (el: HTMLElement) =>
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', button: 0 });

it('eye_tap_toggles_and_hold_peeks', () => {
  renderWithGame(<Harness />);
  const eye = screen.getByRole('button', { name: '隐藏候选' });
  expect(eye).toHaveAttribute('aria-pressed', 'false');
  press(eye);
  release(eye);
  fireEvent.click(eye);
  expect(view().hidden).toBe(true);
  expect(screen.getByRole('button', { name: '隐藏候选' })).toHaveAttribute('aria-pressed', 'true');

  press(eye);
  release(eye);
  fireEvent.click(eye);
  expect(view().hidden).toBe(false);

  press(eye);
  act(() => vi.advanceTimersByTime(400));
  expect(view().held).toBe(true);
  release(eye);
  fireEvent.click(eye);
  expect(view().held).toBe(false);
  // A hold is not also a toggle.
  expect(view().hidden).toBe(false);
});

it('a cancelled hold lets go of the peek', () => {
  renderWithGame(<Harness />);
  const eye = screen.getByRole('button', { name: '隐藏候选' });
  press(eye);
  act(() => vi.advanceTimersByTime(400));
  fireEvent.pointerCancel(eye, { pointerId: 1 });
  expect(view().held).toBe(false);
});

it('the keyboard toggles it', () => {
  renderWithGame(<Harness />);
  // Enter or Space on a focused button is a click with no pointer before it.
  fireEvent.click(screen.getByRole('button', { name: '隐藏候选' }), { detail: 0 });
  expect(view().hidden).toBe(true);
});
