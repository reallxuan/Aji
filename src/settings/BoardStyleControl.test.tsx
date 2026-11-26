import { act, fireEvent, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { renderWithGame } from '../game/renderWithGame';
import { BoardStyleControl, GrainStrengthControl } from './BoardStyleControl';

// The test window is in the dark theme: no `data-theme` reads as dark.
const stored = (theme: 'dark' | 'light' = 'dark') =>
  useDeviceStore.getState().settings.boardStyles[theme];
const mix = { dark: { board: 'printed', stones: 'slate' }, light: null } as const;

/** Opens a Radix select and picks an option by its text. */
function choose(name: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('option', { name: option }), { key: 'Enter' });
}

it('choosing a set and custom mixing update the device settings', () => {
  renderWithGame(<BoardStyleControl />);
  const sets = screen.getByRole('radiogroup', { name: '棋盘样式' });
  // The default, before anything is chosen, is honey with slate and shell.
  expect(within(sets).getByRole('radio', { name: '蜜色配写实' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(screen.queryByRole('combobox', { name: '棋盘' })).toBeNull();

  fireEvent.click(within(sets).getByRole('radio', { name: '榧木配云子' }));
  expect(stored()).toEqual({ board: 'kaya', stones: 'yunzi' });

  fireEvent.click(within(sets).getByRole('radio', { name: '自定义' }));
  // The selects start from the style in use.
  expect(screen.getByRole('combobox', { name: '棋盘' })).toHaveTextContent('榧木');
  choose('棋盘', '胡桃');
  choose('棋子', '平面');
  expect(stored()).toEqual({ board: 'walnut', stones: 'flat' });
  expect(within(sets).getByRole('radio', { name: '自定义' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

it('a stored mix that is no set shows as custom', () => {
  useDeviceStore.getState().update({ boardStyles: mix });
  renderWithGame(<BoardStyleControl />);
  expect(screen.getByRole('radio', { name: '自定义' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('combobox', { name: '棋子' })).toHaveTextContent('写实');
});

it('the custom tile looks like the sets: a swatch with its name under it', () => {
  // A bare word read as unclickable and out of place beside the thumbnails (owner, 2026-11-22).
  renderWithGame(<BoardStyleControl />);
  const custom = () => screen.getByRole('radio', { name: '自定义' });
  const swatch = () => custom().querySelector<HTMLElement>('[data-swatch]');
  expect(swatch()).not.toBeNull();
  expect(swatch()!.style.width).toBe('72px');
  expect(swatch()!.style.height).toBe('72px');
  expect(swatch()!.querySelector('canvas')).toBeNull();
  expect(within(custom()).getByText('自定义')).toBeInTheDocument();
  // Once the style is a mix, the swatch shows it.
  act(() => useDeviceStore.getState().update({ boardStyles: mix }));
  expect(swatch()!.querySelector('canvas')).not.toBeNull();
});

it('the grain slider sets the strength in steps of 5%, and rests when neither board has grain', () => {
  renderWithGame(<GrainStrengthControl />);
  const slider = screen.getByRole('slider', { name: '木纹强度' });
  expect(slider).toHaveAttribute('aria-valuenow', '0.35');
  expect(screen.getByText('35%')).toBeVisible();
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(useDeviceStore.getState().settings.grainStrength).toBe(0.4);
  // The light theme's honey still has grain.
  act(() =>
    useDeviceStore
      .getState()
      .update({ boardStyles: { dark: { board: 'graphite', stones: 'flat' }, light: null } }),
  );
  expect(screen.getByRole('slider', { name: '木纹强度' })).not.toHaveAttribute('data-disabled');
  act(() =>
    useDeviceStore.getState().update({
      boardStyles: {
        dark: { board: 'graphite', stones: 'flat' },
        light: { board: 'printed', stones: 'flat' },
      },
    }),
  );
  expect(screen.getByRole('slider', { name: '木纹强度' })).toHaveAttribute('data-disabled');
});

it('the tiles set the theme the window is in, the line under them the other (dark boards design)', () => {
  renderWithGame(<BoardStyleControl />);
  expect(screen.getByText('深色主题下')).toBeVisible();
  const sets = screen.getByRole('radiogroup', { name: '棋盘样式' });
  fireEvent.click(within(sets).getByRole('radio', { name: '石墨配平面' }));
  expect(stored('dark')).toEqual({ board: 'graphite', stones: 'flat' });
  expect(stored('light')).toBeNull();
  // The other theme's board, honey by default.
  expect(screen.getByRole('combobox', { name: '浅色主题下' })).toHaveTextContent('蜜色');
  choose('浅色主题下', '印刷');
  expect(stored('light')).toEqual({ board: 'printed', stones: 'flat' });
  expect(stored('dark')).toEqual({ board: 'graphite', stones: 'flat' });
});

it("the other theme's mix shows as custom and is kept", () => {
  useDeviceStore.getState().update({
    boardStyles: { dark: null, light: { board: 'kaya', stones: 'flat' } },
  });
  renderWithGame(<BoardStyleControl />);
  expect(screen.getByRole('combobox', { name: '浅色主题下' })).toHaveTextContent('自定义');
  expect(stored('light')).toEqual({ board: 'kaya', stones: 'flat' });
});
