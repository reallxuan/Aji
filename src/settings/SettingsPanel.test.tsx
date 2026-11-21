import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanelStore } from '../app/panelStore';
import { setupTransport, storedSettings } from '../setup/testing';
import { renderWithProviders } from '../setup/testing';
import { initialWizard, useWizardStore } from '../setup/wizardStore';
import { useBenchmarkStore } from '../setup/benchmarkStore';
import { useSetupProgress } from '../setup/useSetupProgress';
import type { EngineState } from '../transport/generated/EngineState';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { SettingsPanel } from './SettingsPanel';
import { useSettingsStore } from './settingsStore';

const ready: EngineState = { state: 'ready', version: '1.18.2', limitReached: false };
const active = {
  engine: 'katago-v1.18.2-metal-macos-arm64',
  version: '1.18.2',
  backend: 'metal' as const,
  network: 'kata1-tf3-b11c768-s12382M-d6533M',
  networkName: 'kata1-tf3-b11c768-s12382M-d6533M',
  threads: 4,
  visitsPerSecond: null as number | null,
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

/** The settings page with the app's progress listener, which routes a benchmark job here. */
function WithProgress() {
  useSetupProgress();
  return <SettingsPanel />;
}

/** A benchmark job on the active set: its downloads are reused. */
function benchmarkJob(
  outcome: JobSnapshot['outcome'],
  benchmark: JobSnapshot['benchmark'],
): JobSnapshot {
  return {
    id: 9,
    engine: active.engine,
    backend: 'metal',
    network: active.network,
    tasks: [
      { task: 'engine', state: { state: 'reused' } },
      { task: 'network', state: { state: 'reused' } },
      {
        task: 'benchmark',
        state: outcome ? { state: 'done' } : { state: 'running', done: 7, total: 15 },
      },
      { task: 'testQuery', state: { state: 'waiting' } },
    ],
    outcome,
    measures: true,
    benchmark,
  };
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
    // A failed benchmark stays on screen until the next one; one test must not see another's.
    useBenchmarkStore.setState({ job: null });
    usePanelStore.setState({ view: 'settings' });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });

  it('saves the default rules for new games, and leaves the open game alone', async () => {
    const transport = mount();
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());
    const rules = screen.getByRole('radiogroup', { name: '新棋局默认规则' });
    expect(within(rules).getByRole('radio', { name: '中国规则' })).toHaveAttribute(
      'data-state',
      'on',
    );
    expect(
      screen.getByText('用于新建的棋局，以及没有写明规则或贴目的棋谱。已打开的棋局不受影响。'),
    ).toBeInTheDocument();
    await act(async () => fireEvent.click(within(rules).getByRole('radio', { name: '自定义' })));
    expect(sets(transport.requests).at(-1)?.defaultRules).toEqual({
      kind: 'custom',
      komi: 7.5,
      scoring: 'area',
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '增加贴目' })));
    expect(sets(transport.requests).at(-1)?.defaultRules).toMatchObject({ komi: 8 });
    expect(transport.requests.some((r) => r.type === 'gameSetRules')).toBe(false);
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

  it('shows or hides the board coordinates', async () => {
    const transport = mount();
    const row = await screen.findByRole('radiogroup', { name: '棋盘坐标' });
    await waitFor(() => expect(useSettingsStore.getState().settings).not.toBeNull());
    expect(within(row).getByRole('radio', { name: '显示' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await act(async () => fireEvent.click(within(row).getByRole('radio', { name: '隐藏' })));
    expect(sets(transport.requests).at(-1)).toMatchObject({ showCoordinates: false });
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
    expect(screen.getByText('权重 kata1-tf3-b11c768-s12382M-d6533M')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重启引擎' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止引擎' })));
    expect(transport.requests.map((r) => r.type)).toEqual(
      expect.arrayContaining(['engineRestart', 'engineStop']),
    );
    fireEvent.click(screen.getByRole('button', { name: '重新设置引擎' }));
    expect(useWizardStore.getState()).toMatchObject({ open: true, rerun: true });
  });

  it('says whether the search thread count was measured', async () => {
    mount();
    expect(await screen.findByText('搜索线程：4（默认值，未测速）')).toBeInTheDocument();
  });

  it('names the measured speed once the count was measured', async () => {
    mount({
      setupInstalled: () => ({
        type: 'setupInstalled',
        active: { ...active, threads: 10, visitsPerSecond: 24.93 },
        unusedBytes: 0,
      }),
    });
    expect(await screen.findByText('搜索线程：10（已测速，25 次/秒）')).toBeInTheDocument();
  });

  it('runs the benchmark from settings, shows its progress there, then the new count', async () => {
    let summary = active;
    const transport = setupTransport({
      setupInstalled: () => ({ type: 'setupInstalled', active: summary, unusedBytes: 0 }),
    });
    renderWithProviders(<WithProgress />, transport, ready);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: '测速' })));
    expect(transport.requests).toContainEqual({
      type: 'setupInstall',
      engine: active.engine,
      network: active.network,
      acceptLicences: [],
      benchmark: true,
    });

    act(() =>
      transport.emit({
        type: 'setupProgress',
        job: benchmarkJob(null, {
          testing: 10,
          positionsDone: 2,
          tested: [{ threads: 6, visitsPerSecond: 23.3 }],
        }),
      }),
    );
    expect(screen.getByText('正在测试 10 个搜索线程')).toBeInTheDocument();
    expect(screen.getByText('6 个线程：23 次/秒')).toBeInTheDocument();
    // The job stays on the settings page: the wizard never sees it.
    expect(useWizardStore.getState()).toMatchObject({ open: false, job: null });
    expect(screen.queryByRole('button', { name: '测速' })).not.toBeInTheDocument();

    summary = { ...active, threads: 10, visitsPerSecond: 24.93 };
    await act(async () =>
      transport.emit({
        type: 'setupProgress',
        job: benchmarkJob({ outcome: 'installed' }, null),
      }),
    );
    expect(await screen.findByText('搜索线程：10（已测速，25 次/秒）')).toBeInTheDocument();
    expect(screen.queryByText('正在测试 10 个搜索线程')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '测速' })).toBeEnabled();
  });

  it('holds the engine buttons and delete while a benchmark runs', async () => {
    const transport = setupTransport({
      setupInstalled: () => ({ type: 'setupInstalled', active, unusedBytes: 1_000_000 }),
    });
    renderWithProviders(<WithProgress />, transport, ready);
    await screen.findByRole('button', { name: '测速' });
    const held = ['重启引擎', '停止引擎', '重新设置引擎', '删除'];
    for (const name of held) expect(screen.getByRole('button', { name })).toBeEnabled();

    act(() =>
      transport.emit({
        type: 'setupProgress',
        job: benchmarkJob(null, { testing: null, positionsDone: 0, tested: [] }),
      }),
    );
    for (const name of held) expect(screen.getByRole('button', { name })).toBeDisabled();

    await act(async () =>
      transport.emit({ type: 'setupProgress', job: benchmarkJob({ outcome: 'cancelled' }, null) }),
    );
    for (const name of held) expect(screen.getByRole('button', { name })).toBeEnabled();
  });

  it('cancels a running benchmark, and says why one failed', async () => {
    const transport = setupTransport({
      setupInstalled: () => ({ type: 'setupInstalled', active, unusedBytes: 0 }),
    });
    renderWithProviders(<WithProgress />, transport, ready);
    await screen.findByText('搜索线程：4（默认值，未测速）');
    act(() =>
      transport.emit({
        type: 'setupProgress',
        job: benchmarkJob(null, { testing: null, positionsDone: 0, tested: [] }),
      }),
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '取消' })));
    expect(transport.requests).toContainEqual({ type: 'setupCancel' });

    act(() =>
      transport.emit({
        type: 'setupProgress',
        job: benchmarkJob(
          {
            outcome: 'failed',
            failure: 'timedOut',
            stderrTail: [],
            offer: null,
            driver: null,
          },
          null,
        ),
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('测速失败：KataGo 响应超时。');
    expect(useWizardStore.getState().open).toBe(false);
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
    expect(screen.getByRole('alert')).toHaveTextContent('引擎正在安装或测速，请在完成后再试。');
  });
});

describe('Unused downloaded files', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: storedSettings });
    useBenchmarkStore.setState({ job: null });
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
