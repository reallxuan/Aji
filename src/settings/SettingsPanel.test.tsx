import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanelStore } from '../app/panelStore';
import { setupTransport, storedSettings } from '../setup/testing';
import { renderWithProviders } from '../setup/testing';
import { initialWizard, useWizardStore } from '../setup/wizardStore';
import type { EngineState } from '../transport/generated/EngineState';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { SettingsPanel } from './SettingsPanel';
import { useSettingsStore } from './settingsStore';

const ready: EngineState = { state: 'ready', version: '1.18.2' };
const active = {
  engine: 'katago-v1.18.2-metal-macos-arm64',
  version: '1.18.2',
  backend: 'metal' as const,
  network: 'kata1-tf3-b11c768-s12382M-d6533M',
  networkName: 'kata1-tf3-b11c768-s12382M-d6533M',
  threads: 4,
};
const sets = (requests: Request[]) =>
  requests.flatMap((r) => (r.type === 'settingsSet' ? [r.settings] : []));

function mount(
  overrides: Parameters<typeof setupTransport>[0] = {},
  engine: EngineState | null = ready,
) {
  const transport = setupTransport({
    setupInstalled: () => ({ type: 'setupInstalled', active, unusedBytes: 0 }),
    ...overrides,
  });
  renderWithProviders(<SettingsPanel />, transport, engine);
  return transport;
}

/** Opens a Radix select and picks an option by its text. */
function choose(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('option', { name: option }), { key: 'Enter' });
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: null });
    useWizardStore.setState(initialWizard);
    usePanelStore.setState({ view: 'settings' });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });

  it('switches language and theme at once', async () => {
    const transport = mount();
    const language = await screen.findByRole('radiogroup', { name: '语言' });
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());
    await act(async () =>
      fireEvent.click(within(language).getByRole('radio', { name: 'English' })),
    );
    expect(await screen.findByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    const theme = screen.getByRole('radiogroup', { name: 'Theme' });
    await act(async () => fireEvent.click(within(theme).getByRole('radio', { name: 'Light' })));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(sets(transport.requests).at(-1)).toMatchObject({ language: 'en', theme: 'light' });
  });

  it("swaps the disc lines when one takes the other line's field, and previews them", async () => {
    const transport = mount();
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());
    const preview = screen.getByRole('img', { name: '选点预览' });
    expect(preview).toHaveTextContent('54.2');
    expect(preview).toHaveTextContent('+1.8');

    choose(screen.getByRole('combobox', { name: '选点第一行' }), '目差');
    await act(async () => {});
    expect(sets(transport.requests).at(-1)?.discLines).toEqual(['scoreLead', 'winrate']);

    choose(screen.getByRole('combobox', { name: '选点第二行' }), '计算量');
    await act(async () => {});
    expect(sets(transport.requests).at(-1)?.discLines).toEqual(['scoreLead', 'visits']);
    expect(screen.getByRole('img', { name: '选点预览' })).toHaveTextContent('1.2k');
  });

  it('takes a visit limit of positive whole numbers, and none when cleared', async () => {
    const transport = mount();
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());
    const input = screen.getByRole('textbox', { name: '每步计算量上限' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', '不限');

    fireEvent.change(input, { target: { value: '1a2,0' } });
    expect(input).toHaveValue('120');
    await act(async () => fireEvent.blur(input));
    expect(sets(transport.requests).at(-1)?.visitLimit).toBe(120);

    fireEvent.change(input, { target: { value: '0' } });
    await act(async () => fireEvent.blur(input));
    expect(sets(transport.requests).at(-1)?.visitLimit).toBeNull();
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '800' } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(sets(transport.requests).at(-1)?.visitLimit).toBe(800);
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => fireEvent.blur(input));
    expect(sets(transport.requests).at(-1)?.visitLimit).toBeNull();
  });

  it('names the active engine and runs the engine actions', async () => {
    const transport = mount();
    expect(await screen.findByText('KataGo 1.18.2 · Metal')).toBeInTheDocument();
    expect(screen.getByText('权重 kata1-tf3-b11c768-s12382M-d6533M · 4 线程')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重启引擎' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止引擎' })));
    expect(transport.requests.map((r) => r.type)).toEqual(
      expect.arrayContaining(['engineRestart', 'engineStop']),
    );
    fireEvent.click(screen.getByRole('button', { name: '重新设置引擎' }));
    expect(useWizardStore.getState()).toMatchObject({ open: true, rerun: true });
  });

  it('disables restart while the engine starts, and shows engineBusy when refused', async () => {
    mount({}, { state: 'starting' });
    expect(await screen.findByRole('button', { name: '重启引擎' })).toBeDisabled();
  });

  it('shows the engineBusy text when a restart is refused', async () => {
    mount({
      engineRestart: (): Response => {
        throw { code: 'engineBusy', message: 'benchmarking' };
      },
    });
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: '重启引擎' })));
    expect(screen.getByRole('alert')).toHaveTextContent('正在安装引擎并测速，请在完成后再试。');
  });
});

describe('Unused downloaded files', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: storedSettings });
    usePanelStore.setState({ view: 'settings' });
  });

  it('is hidden when nothing is unused', async () => {
    mount();
    await screen.findByText('KataGo 1.18.2 · Metal');
    expect(screen.queryByText('未使用的已下载文件')).not.toBeInTheDocument();
  });

  it('shows the size, asks before deleting, then refreshes', async () => {
    let unusedBytes = 1.3 * 1024 ** 3;
    const transport = mount({
      setupInstalled: () => ({ type: 'setupInstalled', active, unusedBytes }),
      setupRemoveUnused: () => {
        unusedBytes = 0;
        return { type: 'setupRemoved', freedBytes: 1.3 * 1024 ** 3 };
      },
    });
    const row = (await screen.findByText('未使用的已下载文件')).closest('div') as HTMLElement;
    expect(row).toHaveTextContent('1.3 GB');
    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1.3 GB');
    expect(transport.requests.some((r) => r.type === 'setupRemoveUnused')).toBe(false);
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: '删除' })));
    expect(transport.requests.some((r) => r.type === 'setupRemoveUnused')).toBe(true);
    await waitFor(() => expect(screen.queryByText('未使用的已下载文件')).not.toBeInTheDocument());
  });
});
