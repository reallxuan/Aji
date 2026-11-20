import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { MoveCounter } from './MoveCounter';

afterEach(() => resetGameStore());

const game = makeSnapshot({ moveNumber: 58, mainLineLength: 171, hasMoves: true });

it('reads current / total, and 0 / 0 with no game', () => {
  const { unmount } = renderWithGame(<MoveCounter />, { snapshot: game });
  expect(screen.getByText('58')).toBeInTheDocument();
  expect(screen.getByText('/ 171')).toBeInTheDocument();
  unmount();
  resetGameStore();
  renderWithGame(<MoveCounter />, { snapshot: null });
  expect(screen.getByText('0')).toBeInTheDocument();
});

it('jumps to a typed move on Enter', async () => {
  const { requests } = renderWithGame(<MoveCounter />, { snapshot: game });
  fireEvent.click(screen.getByRole('button', { name: /58/ }));
  const input = screen.getByRole('textbox');
  expect(input).toHaveValue('58');
  fireEvent.change(input, { target: { value: '12a0' } });
  expect(input).toHaveValue('120');
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  expect(requests).toEqual([{ type: 'gameNavigate', to: { move: 120 } }]);
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('cancels on Escape and on blur', () => {
  const { requests } = renderWithGame(<MoveCounter />, { snapshot: game });
  fireEvent.click(screen.getByRole('button', { name: /58/ }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /58/ }));
  fireEvent.blur(screen.getByRole('textbox'));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(requests).toEqual([]);
});
