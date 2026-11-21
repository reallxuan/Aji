import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { renderWithGame } from '../game/renderWithGame';
import { GameMenu } from '../panel/GameMenu';
import { LayoutFrame } from './LayoutFrame';
import { LayoutSettings } from './LayoutMenu';
import { panelsOf, refId } from './model';
import { validateLayout } from './validate';

/** Opens the 布局 select and picks a preset by its name. */
function choosePreset(name: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: '布局' }), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('option', { name }), { key: 'Enter' });
}

const stored = () => validateLayout(useDeviceStore.getState().settings.layout);
const shownIds = () => panelsOf(stored().root).map(refId);

describe('the 布局 choices in settings', () => {
  beforeEach(() => Object.assign(window, { innerWidth: 1440, innerHeight: 900 }));

  it('choosing a preset replaces the layout', async () => {
    renderWithGame(<LayoutSettings />);
    expect(screen.getByRole('combobox', { name: '布局' })).toHaveTextContent('默认');
    choosePreset('经典');
    await waitFor(() => expect(stored().preset).toBe('classic'));
    expect(screen.getByRole('combobox', { name: '布局' })).toHaveTextContent('经典');
  });

  it('a custom layout reads 自定义', async () => {
    renderWithGame(<LayoutSettings />);
    fireEvent.click(screen.getByRole('checkbox', { name: '走势' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '布局' })).toHaveTextContent('自定义'),
    );
  });

  it('a checkbox hides a panel and shows it again', async () => {
    renderWithGame(<LayoutSettings />);
    const trend = screen.getByRole('checkbox', { name: '走势' });
    expect(trend).toBeChecked();
    fireEvent.click(trend);
    await waitFor(() => expect(shownIds()).not.toContain('trend'));
    expect(stored().preset).toBe('custom');
    fireEvent.click(screen.getByRole('checkbox', { name: '走势' }));
    await waitFor(() => expect(shownIds()).toContain('trend'));
  });

  it('the header has no checkbox, and the sub-boards have one each', () => {
    renderWithGame(<LayoutSettings />);
    expect(screen.queryByRole('checkbox', { name: '标题栏' })).toBeNull();
    for (const name of ['副盘 1', '副盘 2', '副盘 3'])
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
  });

  it('a wide window counts the default sub-board as shown', () => {
    Object.assign(window, { innerWidth: 1920, innerHeight: 1080 });
    renderWithGame(<LayoutSettings />);
    expect(screen.getByRole('checkbox', { name: '副盘 1' })).toBeChecked();
  });

  it('恢复默认 returns the default', async () => {
    useDeviceStore.getState().update({ layout: { ...stored(), preset: 'custom', hidden: [] } });
    renderWithGame(<LayoutSettings />);
    choosePreset('极简');
    await waitFor(() => expect(stored().preset).toBe('minimal'));
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    await waitFor(() => expect(stored().preset).toBe('default'));
  });

  it('the frame shows a menu choice at once, before it is saved', () => {
    renderWithGame(
      <>
        <LayoutSettings />
        <LayoutFrame />
      </>,
    );
    choosePreset('经典');
    expect(document.querySelector('[data-panel="subboard:1"]')).not.toBeNull();
  });
});

describe('the 布局 submenu of the game menu', () => {
  it('lists the presets and applies one', async () => {
    renderWithGame(<GameMenu />);
    await act(async () => {});
    const trigger = screen.getByRole('button', { name: '未命名棋局' });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: '布局' });
    await act(async () => {
      item.focus();
      fireEvent.keyDown(item, { key: 'ArrowRight' });
    });
    const sub = screen.getAllByRole('menu').at(-1) as HTMLElement;
    for (const name of ['默认', '经典', '极简', '思考', '四盘'])
      expect(within(sub).getByRole('menuitemradio', { name })).toBeInTheDocument();
    expect(within(sub).getByRole('menuitemcheckbox', { name: '走势' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(sub).getByRole('menuitemradio', { name: '四盘' }));
    });
    await waitFor(() => expect(stored().preset).toBe('four'));
  });
});
