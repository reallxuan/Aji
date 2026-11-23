import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanelStore } from '../app/panelStore';
import { renderWithProviders, setupTransport } from '../setup/testing';
import { AboutPanel } from './AboutPanel';

const openExternal = vi.fn<(url: string) => Promise<void>>(async () => {});
vi.mock('../platform/openExternal', () => ({ openExternal: (url: string) => openExternal(url) }));

describe('AboutPanel', () => {
  beforeEach(() => {
    usePanelStore.setState({ view: 'about' });
    openExternal.mockClear();
  });

  it('shows the version, the licence and a source link', async () => {
    renderWithProviders(<AboutPanel />, setupTransport());
    expect(await screen.findByText('Aji 版本 0.1.0（macOS aarch64）')).toBeInTheDocument();
    expect(screen.getByText(/GNU Affero 通用公共许可证第 3 版或更高版本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'github.com/reallxuan/Aji' }));
    expect(openExternal).toHaveBeenCalledWith('https://github.com/reallxuan/Aji');
  });

  it('opens each bundled licence text', async () => {
    renderWithProviders(<AboutPanel />, setupTransport());
    fireEvent.click(screen.getByRole('button', { name: /KataGo 许可/ }));
    expect(screen.getByText(/currently relies on several other libraries/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    fireEvent.click(screen.getByRole('button', { name: /权重许可/ }));
    expect(screen.getByText(/KataGo Neural Network License/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    fireEvent.click(screen.getByRole('button', { name: /霞鹜文楷/ }));
    expect(screen.getByText(/SIL OPEN FONT LICENSE/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /其他开源组件/ })));
    expect(await screen.findByText(/Open-source components in Aji/)).toBeInTheDocument();
  });

  it('goes back to settings', () => {
    renderWithProviders(<AboutPanel />, setupTransport());
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(usePanelStore.getState().view).toBe('settings');
  });
});
