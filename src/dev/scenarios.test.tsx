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
      expect(one.nodes[1].loss).toBeNull();
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

it('scenario game edits through the transport', async () => {
  const transport = scenarioTransport('game')!;
  const events: AppEvent[] = [];
  transport.subscribe((e) => events.push(e));
  await transport.request({ type: 'gameNew', size: 9 });
  await transport.request({
    type: 'gameEdit',
    edit: { kind: 'play', mv: { type: 'play', x: 1, y: 1 } },
  });
  await transport.request({ type: 'gameNavigate', to: 'first' });
  await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
  const exported = await transport.request({
    type: 'gameExport',
    options: { scope: 'branch', clean: true, inPlace: false },
  });
  expect(exported).toMatchObject({ type: 'gameExport', text: expect.stringContaining('B[]') });
  expect(exported).toMatchObject({ text: expect.not.stringContaining('B[bb]') });
  expect(events.filter((e) => e.type === 'gameTrend').map((e) => e.reason)).toEqual([
    'reset',
    'lineChanged',
    'lineChanged',
  ]);
  expect(transport.unhandled).toEqual([]);
});

it('fake save handshake clears changed only for the written edit', async () => {
  const transport = scenarioTransport('game')!;
  const files = createFakeFiles({ files: { '/game.sgf': '(;)' } });
  const edit = (text: string) =>
    transport.request({ type: 'gameEdit', edit: { kind: 'setComment', node: 0, text } });
  await edit('囲碁');
  const out = await transport.request({
    type: 'gameExport',
    options: { scope: 'game', clean: false, inPlace: true },
  });
  if (out.type !== 'gameExport' || !out.bytes) throw new Error('no byte export');
  await edit('newer');
  await files.save('/game.sgf', out.bytes);
  expect(files.written.get('/game.sgf')).toContain('C[囲碁]');
  expect((await files.openPath('/game.sgf')).bytes).toBe(out.bytes);
  await expect(
    transport.request({ type: 'gameSaved', editId: out.editId, utf8: true }),
  ).resolves.toMatchObject({ snapshot: { changed: true } });
  await expect(transport.request({ type: 'gameUndo' })).resolves.toMatchObject({
    snapshot: { changed: false },
  });
});

it('keeps main-line job results off a variation with the same line index', async () => {
  vi.useFakeTimers();
  try {
    const transport = scenarioTransport('job-done', { tick: 50 })!;
    const events: AppEvent[] = [];
    transport.subscribe((e) => events.push(e));
    const edit = await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
    if (edit.type !== 'game') throw new Error('no game');
    const pushed = events.at(-1);
    expect(pushed).toMatchObject({
      type: 'gameTrend',
      reason: 'lineChanged',
      revision: edit.snapshot.lineRevision,
    });
    if (pushed?.type !== 'gameTrend') throw new Error('no trend');
    expect(pushed.nodes[0].stats).not.toBeNull();
    expect(pushed.nodes[1].stats).toBeNull();
    await transport.request({ type: 'gameNavigate', to: 'previousSibling' });
    const trend = await transport.request({ type: 'gameTrend' });
    if (trend.type !== 'trend') throw new Error('no trend');
    expect(trend.nodes[1].stats).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('simulates live engine updates only on the main line', async () => {
  vi.useFakeTimers();
  try {
    const transport = scenarioTransport('analysing')!;
    const events: AppEvent[] = [];
    transport.subscribe((e) => events.push(e));
    await transport.request({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: false });
    await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
    await expect(transport.request({ type: 'engineStatus' })).resolves.toMatchObject({
      engine: { state: 'ready', limitReached: false },
    });
    vi.advanceTimersByTime(300);
    expect(events.filter((e) => e.type === 'analysisUpdate')).toEqual([]);
    await transport.request({ type: 'gameNavigate', to: 'mainLine' });
    vi.advanceTimersByTime(300);
    expect(events.filter((e) => e.type === 'analysisUpdate').length).toBeGreaterThan(0);
    await expect(transport.request({ type: 'engineStatus' })).resolves.toMatchObject({
      engine: { state: 'analysing' },
    });
  } finally {
    vi.useRealTimers();
  }
});

it('starts a fresh live search when another fixture reuses the same fake slot', async () => {
  vi.useFakeTimers();
  try {
    const transport = scenarioTransport('analysing')!;
    const events: AppEvent[] = [];
    transport.subscribe((e) => events.push(e));
    vi.advanceTimersByTime(300);
    await transport.request({ type: 'gameNew', size: 9 });
    events.length = 0;
    vi.advanceTimersByTime(100);
    const update = events.find((e) => e.type === 'analysisUpdate');
    expect(update).toMatchObject({ analysis: { boardSize: 9, previousVisits: 0, rootVisits: 50 } });
  } finally {
    vi.useRealTimers();
  }
});

it('a selected-line job on a variation searches only its shared main-line prefix', async () => {
  vi.useFakeTimers();
  try {
    const transport = scenarioTransport('game')!;
    const events: AppEvent[] = [];
    transport.subscribe((e) => events.push(e));
    await transport.request({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: false });
    await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
    const settings = await transport.request({ type: 'settingsGet' });
    if (settings.type !== 'settings') throw new Error('no settings');
    await transport.request({
      type: 'jobStart',
      options: { ...settings.settings.jobOptions, scope: 'line' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'jobProgress', progress: { total: 1 } });
    await transport.request({ type: 'jobStop' });
  } finally {
    vi.useRealTimers();
  }
});

it('a job counts a duplicated comment-only position once', async () => {
  vi.useFakeTimers();
  try {
    const transport = scenarioTransport('game')!;
    const events: AppEvent[] = [];
    transport.subscribe((e) => events.push(e));
    await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
    for (const stone of ['white', null] as const)
      await transport.request({
        type: 'gameEdit',
        edit: { kind: 'setupStone', point: { x: 0, y: 0 }, stone },
      });
    const settings = await transport.request({ type: 'settingsGet' });
    if (settings.type !== 'settings') throw new Error('no settings');
    await transport.request({
      type: 'jobStart',
      options: { ...settings.settings.jobOptions, scope: 'line' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'jobProgress', progress: { total: 2 } });
    await transport.request({ type: 'jobStop' });
  } finally {
    vi.useRealTimers();
  }
});

it('clears a reached limit on a variation, keeps pause and restores the cached main-line limit', async () => {
  vi.useFakeTimers();
  try {
    const transport = scenarioTransport('analysing')!;
    const status = () => transport.request({ type: 'engineStatus' });
    const settings = await transport.request({ type: 'settingsGet' });
    if (settings.type !== 'settings') throw new Error('no settings');
    await transport.request({
      type: 'settingsSet',
      settings: { ...settings.settings, visitLimit: 50 },
    });
    await transport.request({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: false });
    vi.advanceTimersByTime(100);
    await expect(status()).resolves.toMatchObject({
      engine: { state: 'ready', limitReached: true },
    });
    await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
    await expect(status()).resolves.toMatchObject({
      engine: { state: 'ready', limitReached: false },
    });
    await transport.request({ type: 'analysisPause' });
    await transport.request({ type: 'gameNavigate', to: 'mainLine' });
    vi.advanceTimersByTime(300);
    await expect(status()).resolves.toMatchObject({ engine: { state: 'paused' } });
    await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
    await transport.request({ type: 'analysisResume' });
    await expect(status()).resolves.toMatchObject({
      engine: { state: 'ready', limitReached: false },
    });
    await transport.request({ type: 'gameNavigate', to: 'mainLine' });
    vi.advanceTimersByTime(100);
    await expect(status()).resolves.toMatchObject({
      engine: { state: 'ready', limitReached: true },
    });
  } finally {
    vi.useRealTimers();
  }
});

it('keeps the engine busy on a variation until the main-line job finishes', async () => {
  vi.useFakeTimers();
  try {
    const transport = scenarioTransport('analysing', { tick: 50 })!;
    const settings = await transport.request({ type: 'settingsGet' });
    if (settings.type !== 'settings') throw new Error('no settings');
    await transport.request({ type: 'gameOpen', name: 'samsung.sgf', bytes: '', atEnd: false });
    await transport.request({ type: 'jobStart', options: settings.settings.jobOptions });
    await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
    vi.advanceTimersByTime(100);
    await expect(transport.request({ type: 'engineStatus' })).resolves.toMatchObject({
      engine: { state: 'analysing' },
    });
    vi.advanceTimersByTime(30000);
    await expect(transport.request({ type: 'engineStatus' })).resolves.toMatchObject({
      engine: { state: 'ready', limitReached: false },
    });
  } finally {
    vi.useRealTimers();
  }
});

it('keeps root estimates stable on consecutive slots with the same position', async () => {
  vi.useFakeTimers();
  try {
    const transport = scenarioTransport('analysing')!;
    const updates: AnalysisUpdate[] = [];
    transport.subscribe((e) => {
      if (e.type === 'analysisUpdate') updates.push(e.analysis);
    });
    await transport.request({ type: 'gameEdit', edit: { kind: 'pass' } });
    for (const stone of ['white', null] as const)
      await transport.request({
        type: 'gameEdit',
        edit: { kind: 'setupStone', point: { x: 0, y: 0 }, stone },
      });
    vi.advanceTimersByTime(100);
    const commentSlot = updates.at(-1)!;
    await transport.request({ type: 'gameNavigate', to: 'previous' });
    vi.advanceTimersByTime(100);
    expect(updates.at(-1)).toMatchObject({
      position: commentSlot.position,
      winrate: commentSlot.winrate,
      scoreLead: commentSlot.scoreLead,
    });
  } finally {
    vi.useRealTimers();
  }
});
