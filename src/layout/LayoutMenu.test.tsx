import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { renderWithGame } from '../game/renderWithGame';
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
