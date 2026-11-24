import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { usePanelStore } from '../app/panelStore';
import { createFakeFiles } from '../platform/fakeFiles';
import { PlatformProvider } from '../platform/PlatformProvider';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { createI18n } from '../i18n/createI18n';
import { useSettingsStore } from '../settings/settingsStore';
import { initialWizard, useWizardStore } from '../setup/wizardStore';
import { TransportProvider } from '../transport/TransportProvider';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { EngineState } from '../transport/generated/EngineState';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import { SCENARIOS, scenarioTransport } from './scenarios';

vi.mock('../platform/openExternal', () => ({ openExternal: async () => {} }));

function mount(name: string) {
  const transport = scenarioTransport(name, { tick: 1 });
  if (!transport) throw new Error(`no scenario ${name}`);
  render(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={createEngineStore()}>
          <PlatformProvider files={createFakeFiles()}>
            <App />
          </PlatformProvider>
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>,
  );
  return transport;
}

const click = async (name: string) => {
  const button = await screen.findByRole('button', { name }, { timeout: 3000 });
  await waitFor(() => expect(button).toBeEnabled());
  await act(async () => fireEvent.click(button));
};

/** From step 1 to the install, taking every preselected row. */
async function throughTheWizard() {
  await screen.findByText('选择后端', undefined, { timeout: 3000 });
  await click('下一步');
  await screen.findByText('选择 KataGo 版本');
  await click('下一步');
  await screen.findByText('选择权重');
  await click('开始安装');
}

const settle = { timeout: 3000 };

describe('development scenarios', () => {
  beforeEach(() => {
    // The scenarios follow the system language; the assertions read the Chinese interface.
    Object.defineProperty(navigator, 'languages', { value: ['zh-CN'], configurable: true });
    useWizardStore.setState(initialWizard);
    useSettingsStore.setState({ settings: null });
    usePanelStore.setState({ view: 'main' });
  });

  it('are all known by name, and an unknown name gives none', () => {
    expect(SCENARIOS).toEqual([
      'pc-cuda',
      'pc-old-driver',
      'cuda-licence',
      'a1-driver',
      'a2-gpu-error',
      'b-download-failed',
      'd-crashed',
      'no-engine',
      'mac',
      'game',
      'analysing',
      'job-running',
      'job-done',
    ]);
    expect(scenarioTransport('nope')).toBeNull();
  });

  it('pc-cuda installs CUDA and ends at a ready engine', async () => {
    const transport = mount('pc-cuda');
    await throughTheWizard();
    expect(await screen.findByText('KataGo 已就绪。', undefined, settle)).toBeInTheDocument();
    expect(transport.unhandled).toEqual([]);
  });

  it('pc-old-driver shows CUDA disabled until detection runs again', async () => {
    const transport = mount('pc-old-driver');
    const cuda = await screen.findByRole('radio', { name: /CUDA/ }, settle);
    expect(cuda).toBeDisabled();
    await click('重新检测');
    await waitFor(() => expect(screen.getByRole('radio', { name: /CUDA/ })).toBeEnabled());
    expect(transport.unhandled).toEqual([]);
  });

  it('cuda-licence asks for the NVIDIA licences before downloading', async () => {
    const transport = mount('cuda-licence');
    await throughTheWizard();
    expect(await screen.findByText('需要接受许可协议', undefined, settle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    await click('接受并安装');
    expect(await screen.findByText('KataGo 已就绪。', undefined, settle)).toBeInTheDocument();
    expect(transport.unhandled).toEqual([]);
  });

  it('a1-driver fails with an old driver, and DirectML installs', async () => {
    const transport = mount('a1-driver');
    await throughTheWizard();
    expect(await screen.findByText('CUDA 无法使用', undefined, settle)).toBeInTheDocument();
    expect(screen.getByText(/566\.36/)).toBeInTheDocument();
    await click('改用 DirectML（22 MB）');
    expect(await screen.findByText('KataGo 已就绪。', undefined, settle)).toBeInTheDocument();
    expect(transport.unhandled).toEqual([]);
  });

  it('a2-gpu-error fails with a GPU error and offers DirectML first', async () => {
    const transport = mount('a2-gpu-error');
    await throughTheWizard();
    expect(
      await screen.findByText('KataGo 无法通过此后端使用显卡。', undefined, settle),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改用 DirectML（22 MB）' })).toHaveAttribute(
      'data-variant',
      'default',
    );
    expect(transport.unhandled).toEqual([]);
  });

  it('b-download-failed stops at panel B, and a retry fails the same way', async () => {
    const transport = mount('b-download-failed');
    await throughTheWizard();
    expect(await screen.findByText('安装没有完成', undefined, settle)).toBeInTheDocument();
    await click('重试');
    expect(await screen.findByText('安装没有完成', undefined, settle)).toBeInTheDocument();
    expect(transport.unhandled).toEqual([]);
  });

  it('d-crashed opens on the crashed engine, which can be set up again', async () => {
    const transport = mount('d-crashed');
    expect(await screen.findByText('KataGo 已停止运行。', undefined, settle)).toBeInTheDocument();
    await click('重新设置引擎');
    expect(await screen.findByText('选择后端', undefined, settle)).toBeInTheDocument();
    expect(transport.unhandled).toEqual([]);
  });

  it('no-engine reaches the no-engine panel after "set up later"', async () => {
    const transport = mount('no-engine');
    await click('暂不设置');
    expect(await screen.findByText('尚未设置引擎')).toBeInTheDocument();
    expect(transport.unhandled).toEqual([]);
  });

  it('mac installs Metal and ends at a ready engine', async () => {
    const transport = mount('mac');
    await throughTheWizard();
    expect(await screen.findByText('KataGo 已就绪。', undefined, settle)).toBeInTheDocument();
    expect(transport.unhandled).toEqual([]);
  });

  it('job-running plays a job: progress, trend nodes, a boost pass, and done', async () => {
    vi.useFakeTimers();
    try {
      const transport = scenarioTransport('job-running', { tick: 50 })!;
      const events: AppEvent[] = [];
      transport.subscribe((event) => events.push(event));
      vi.advanceTimersByTime(60_000);
      const progress = events.flatMap((e) => (e.type === 'jobProgress' ? [e.progress] : []));
      const states = progress.map((p) => p.state);
      expect(states[0]).toBe('running');
      expect(states).toContain('boosting');
      expect(states.at(-1)).toBe('done');
      expect(progress.at(-1)).toMatchObject({ done: 243, total: 243 });
      const trend = await transport.request({ type: 'gameTrend' });
      if (trend.type !== 'trend') throw new Error('no trend');
      expect(trend.nodes.every((n) => n.stats !== null)).toBe(true);
      expect(trend.nodes.some((n) => n.loss && Math.abs(n.loss.winrate) >= 10)).toBe(true);
      const pushed = events.flatMap((e) => (e.type === 'trendNodes' ? [e] : []));
      expect(pushed.length).toBeGreaterThan(0);
      expect(pushed.every((e) => e.revision === trend.revision)).toBe(true);

      // Started again and stopped: the status reads stopped.
      const settings = await transport.request({ type: 'settingsGet' });
      if (settings.type !== 'settings') throw new Error('no settings');
      await transport.request({ type: 'jobStart', options: settings.settings.jobOptions });
      vi.advanceTimersByTime(100);
      await transport.request({ type: 'jobStop' });
      const last = events.flatMap((e) => (e.type === 'jobProgress' ? [e.progress] : [])).at(-1);
      expect(last?.state).toBe('stopped');
      await transport.request({ type: 'cacheClear', scope: 'position' });
      const one = events.at(-1);
      expect(one).toMatchObject({ type: 'gameTrend', reason: 'reset' });
      if (one?.type !== 'gameTrend') throw new Error('no trend');
      expect(one.nodes[0].stats).toBeNull();
      expect(one.nodes[1].stats).not.toBeNull();
      await transport.request({ type: 'cacheClear', scope: 'game' });
      const cleared = events.at(-1);
      expect(cleared).toMatchObject({ type: 'gameTrend', reason: 'reset' });
      if (cleared?.type !== 'gameTrend') throw new Error('no trend');
      expect(cleared.nodes.every((node) => node.stats === null)).toBe(true);
      await expect(transport.request({ type: 'cacheStats' })).resolves.toMatchObject({
        type: 'cacheStats',
        persistent: true,
      });
      await expect(
        transport.request({ type: 'gameScore', mode: { kind: 'estimate' } }),
      ).rejects.toMatchObject({ code: 'scoreUnavailable' });
      expect(transport.unhandled).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a running job and its cached results through equivalent rules edits', async () => {
    vi.useFakeTimers();
    try {
      const transport = scenarioTransport('job-running', { tick: 50 })!;
      const events: AppEvent[] = [];
      transport.subscribe((event) => events.push(event));
      vi.advanceTimersByTime(200);
      const before = await transport.request({ type: 'cacheStats' });
      if (before.type !== 'cacheStats') throw new Error('no cache');
      expect(before.usedBytes).toBeGreaterThan(0);
      await transport.request({
        type: 'gameEdit',
        edit: {
          kind: 'setRules',
          rules: { kind: 'custom', details: null, scoring: 'territory', komi: 6.5 },
        },
      });
      expect(await transport.request({ type: 'cacheStats' })).toEqual(before);
      vi.advanceTimersByTime(100);
      expect(events.some((e) => e.type === 'jobProgress' && e.progress.state === 'stopped')).toBe(
        false,
      );
      const after = await transport.request({ type: 'cacheStats' });
      if (after.type !== 'cacheStats') throw new Error('no cache');
      expect(after.usedBytes).toBeGreaterThan(before.usedBytes);
    } finally {
      vi.useRealTimers();
    }
  });

  it('job-done opens on an analysed game with the job just done', async () => {
    vi.useFakeTimers();
    try {
      const transport = scenarioTransport('job-done', { tick: 50 })!;
      const events: AppEvent[] = [];
      transport.subscribe((event) => events.push(event));
      vi.advanceTimersByTime(1000);
      const progress = events.flatMap((e) => (e.type === 'jobProgress' ? [e.progress] : []));
      expect(progress.map((p) => p.state)).toEqual(['done']);
      const trend = await transport.request({ type: 'gameTrend' });
      if (trend.type !== 'trend') throw new Error('no trend');
      expect(trend.nodes).toHaveLength(243);
      expect(trend.nodes.every((n) => n.stats !== null)).toBe(true);
      expect(transport.unhandled).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('analysing feeds the position on the board, stops at the limit and continues', async () => {
    vi.useFakeTimers();
    try {
      const transport = scenarioTransport('analysing')!;
      const events: AppEvent[] = [];
      transport.subscribe((event) => events.push(event));
      const updates = () =>
        events.flatMap((e): AnalysisUpdate[] => (e.type === 'analysisUpdate' ? [e.analysis] : []));
      const states = () =>
        events.flatMap((e): EngineState[] => (e.type === 'engineState' ? [e.engine] : []));
      const settings = await transport.request({ type: 'settingsGet' });
      if (settings.type !== 'settings') throw new Error('no settings');
      await transport.request({
        type: 'settingsSet',
        settings: { ...settings.settings, visitLimit: 300 },
      });
      await transport.request({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: false });
      const at = async (move: number) => {
        const reply = await transport.request({ type: 'gameNavigate', to: { move } });
        return (reply as { snapshot: GameSnapshot }).snapshot;
      };
      const fifty = await at(50);
      events.length = 0;

      vi.advanceTimersByTime(1000);
      const first = updates();
      expect(first.length).toBeGreaterThan(3);
      expect(first.every((u) => u.position === fifty.positionKey)).toBe(true);
      expect(first.map((u) => u.rootVisits)).toEqual(
        [...first.map((u) => u.rootVisits)].sort((a, b) => a - b),
      );
      expect(first.at(-1)!.rootVisits).toBe(300);
      expect(states().at(-1)).toEqual({ state: 'ready', version: '1.18.2', limitReached: true });

      // Continue searches again from zero, catching up on the 300 visits already cached.
      events.length = 0;
      await transport.request({ type: 'analysisContinue' });
      vi.advanceTimersByTime(300);
      expect(states()[0]).toEqual({ state: 'analysing', version: '1.18.2' });
      expect(updates()[0]).toMatchObject({ previousVisits: 300 });
      expect(updates()[0].rootVisits).toBeLessThan(300);
      vi.advanceTimersByTime(2000);
      expect(updates().at(-1)!.rootVisits).toBe(600);

      // Pausing stops the feed.
      await at(51);
      await transport.request({ type: 'analysisPause' });
      events.length = 0;
      vi.advanceTimersByTime(500);
      expect(updates()).toEqual([]);
      await transport.request({ type: 'analysisResume' });
      vi.advanceTimersByTime(500);
      expect(updates().length).toBeGreaterThan(0);
      expect(transport.unhandled).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('analysing stops at once when the limit is lowered below the search', async () => {
    vi.useFakeTimers();
    try {
      const transport = scenarioTransport('analysing')!;
      const states: EngineState[] = [];
      transport.subscribe((e) => {
        if (e.type === 'engineState') states.push(e.engine);
      });
      vi.advanceTimersByTime(1000);
      const settings = await transport.request({ type: 'settingsGet' });
      if (settings.type !== 'settings') throw new Error('no settings');
      await transport.request({
        type: 'settingsSet',
        settings: { ...settings.settings, visitLimit: 100 },
      });
      vi.advanceTimersByTime(200);
      expect(states.at(-1)).toEqual({ state: 'ready', version: '1.18.2', limitReached: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
