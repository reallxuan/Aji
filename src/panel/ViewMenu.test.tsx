import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { validateLayout } from '../layout/validate';
import { GameMenu } from './GameMenu';
import { PanelHeader } from './PanelHeader';

afterEach(() => resetGameStore());

const stored = () => validateLayout(useDeviceStore.getState().settings.layout);

async function open(name: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
  });
  return screen.getByRole('menu');
}

async function openSub(menu: HTMLElement, name: string) {
  const item = within(menu).getByRole('menuitem', { name });
  await act(async () => {
    item.focus();
    fireEvent.keyDown(item, { key: 'ArrowRight' });
  });
  return screen.getAllByRole('menu').at(-1) as HTMLElement;
}

it('without a menu bar, the 视图 button holds 布局 and 截图 (owner, 2026-11-22)', async () => {
  renderWithGame(<PanelHeader />, { os: 'windows' });
  await act(async () => {});
  const menu = await open('视图');
  expect(within(menu).getByRole('menuitem', { name: '截图' })).toBeInTheDocument();
  const layout = await openSub(menu, '布局');
  for (const name of ['默认', '经典', '极简', '思考', '四盘'])
    expect(within(layout).getByRole('menuitemradio', { name })).toBeInTheDocument();
  expect(within(layout).getByRole('menuitemcheckbox', { name: '走势' })).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(within(layout).getByRole('menuitemradio', { name: '四盘' }));
  });
  await waitFor(() => expect(stored().preset).toBe('four'));
});

it('on the Mac the menu bar has them, so the header has no 视图 button', async () => {
  renderWithGame(<PanelHeader />, { os: 'macos' });
  await act(async () => {});
  expect(screen.queryByRole('button', { name: '视图' })).toBeNull();
});

it('the game menu keeps to the game: no 截图 and no 布局', async () => {
  for (const os of ['macos', 'windows'] as const) {
    const { unmount } = renderWithGame(<GameMenu />, { os });
    await act(async () => {});
    const menu = await open('未命名棋局');
    expect(within(menu).queryByRole('menuitem', { name: '截图' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: '布局' })).toBeNull();
    unmount();
  }
});
