import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { usePanelStore } from '../app/panelStore';
import { candidate, play, subBoardHarness } from '../analysis/subBoardTesting';
import { resetViewStore, useViewStore } from '../analysis/viewStore';
import { useDeviceStore } from '../device/deviceStore';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { PlatformProvider } from '../platform/PlatformProvider';
import { runningJob, setupTransport } from '../setup/testing';
import { useWizardStore } from '../setup/wizardStore';
import type { EngineState } from '../transport/generated/EngineState';
import type { Response } from '../transport/generated/Response';
import { TransportProvider } from '../transport/TransportProvider';
import { LayoutFrame } from './LayoutFrame';
import { hidePanel } from './ops';
import { presetLayout } from './presets';

function setWindow(width: number, height: number) {
  Object.assign(window, { innerWidth: width, innerHeight: height });
}
const shown = () =>
  [...document.querySelectorAll('[data-panel]')].map((el) => el.getAttribute('data-panel'));
const tabs = () => screen.queryAllByRole('tab').map((t) => t.textContent);
const bottomNav = () => screen.queryByRole('navigation', { name: '棋谱导航' });

function renderApp(engine: EngineState) {
  const transport = setupTransport({
    engineStatus: () => ({
      type: 'engineStatus',
      engine,
      position: '0000000000000000',
      analysis: null,
      rejected: null,
      running: null,
    }),
    appInfo: () => ({ type: 'appInfo', version: '0.1.0', os: 'macos', arch: 'aarch64' }),
    setupDetect: () => new Promise<Response>(() => {}),
  });
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
}

describe('the narrow arrangement', () => {
  beforeEach(() => {
    setWindow(375, 812);
    useWizardStore.setState({ open: false, dismissed: false, rerun: false });
    usePanelStore.setState({ view: 'main' });
  });

  it('375×812 shows tabs and the bottom navigation', () => {
    renderWithGame(<LayoutFrame />);
    expect(document.querySelector('[data-narrow]')).not.toBeNull();
    expect(tabs()).toEqual(['走势', '候选']);
    expect(shown()).toEqual(['trend']);
    expect(within(bottomNav()!).getAllByRole('button')).toHaveLength(4);
    // The board takes the width, less 4 px each side.
    expect((document.querySelector('[data-board]') as HTMLElement).style.width).toBe('367px');
  });

  it('a small landscape window keeps the board above the panels (Review Focus 4)', () => {
    setWindow(560, 420);
    renderWithGame(<LayoutFrame />);
    expect(document.querySelector('[data-narrow]')).not.toBeNull();
    // 420 − 52 (header) − 48 (bar) − 72 (navigation): the board takes it all.
    expect((document.querySelector('[data-board]') as HTMLElement).style.width).toBe('248px');
    // A phone tall enough keeps 160 px for the panels while the board stays at 320 px or more.
    setWindow(375, 667);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect((document.querySelector('[data-board]') as HTMLElement).style.width).toBe('335px');
  });

  it('Thinking draws a line on the board unless sub-board 1 is on screen', async () => {
    useDeviceStore.getState().update({ layout: presetLayout('thinking') });
    // Earlier tests leave a newer snapshot; the harness starts its own game.
    resetGameStore();
    resetViewStore();
    const h = subBoardHarness();
    render(
      <h.wrapper>
        <LayoutFrame />
      </h.wrapper>,
    );
    const pv = [play(3), play(4), play(5)];
    h.analyse([candidate(0, 0.55, pv)]);
    await act(async () => {});
    act(() => useViewStore.getState().setHover({ move: pv[0], source: 'board' }));
    await act(async () => {});
    expect(useViewStore.getState().variation).not.toBeNull();
    const line = () => (document.querySelector('[data-board]') as HTMLElement).dataset.line;
    // The sub-board tab is showing: the line is drawn there, not on the board.
    expect(screen.getByRole('tab', { name: '副盘' })).toHaveAttribute('aria-selected', 'true');
    expect(line()).toBeUndefined();
    fireEvent.click(screen.getByRole('tab', { name: '候选' }));
    expect(line()).toBe('shown');
  });

  it('768×1024 shows two panels side by side without the bottom navigation', () => {
    setWindow(768, 1024);
    renderWithGame(<LayoutFrame />);
    expect(bottomNav()).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(shown()).toEqual(['trend', 'candidates']);
    // The header keeps the full navigation there.
    expect(screen.getByRole('button', { name: '下一手' })).toBeInTheDocument();
  });

  it('tabs follow the layout order and skip hidden panels', () => {
    useDeviceStore.getState().update({ layout: presetLayout('classic') });
    const first = renderWithGame(<LayoutFrame />);
    expect(tabs()).toEqual(['走势', '候选', '副盘']);
    first.unmount();
    useDeviceStore
      .getState()
      .update({ layout: hidePanel(presetLayout('default'), { kind: 'trend' }) });
    renderWithGame(<LayoutFrame />);
    expect(tabs()).toEqual(['候选']);
  });

  it('the active tab is remembered', () => {
    const first = renderWithGame(<LayoutFrame />);
    fireEvent.click(screen.getByRole('tab', { name: '候选' }));
    expect(shown()).toEqual(['candidates']);
    expect(useDeviceStore.getState().settings.narrowTab).toBe('candidates');
    first.unmount();
    renderWithGame(<LayoutFrame />);
    expect(screen.getByRole('tab', { name: '候选' })).toHaveAttribute('aria-selected', 'true');
  });

  it('touch targets are at least 44 px', () => {
    renderWithGame(<LayoutFrame />);
    const targets = [
      ...within(bottomNav()!).getAllByRole('button'),
      ...screen.getAllByRole('tab'),
      screen.getByRole('button', { name: '设置' }),
    ];
    for (const target of targets) expect(target).toHaveClass('min-h-11', 'min-w-11');
    // The engine dot stays 10 px and reaches 44 px with its invisible margin.
    expect(document.querySelector('[data-engine-dot]')).toHaveClass('after:-inset-[17px]');
  });

  it('settings open as a sheet and close', async () => {
    renderApp({ state: 'ready', version: '1.18.2', limitReached: false });
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '设置' })));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: '设置' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(usePanelStore.getState().view).toBe('main');
  });

  it('the first-run wizard shows in the sheet', async () => {
    renderApp({ state: 'notConfigured' });
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('准备 AI 引擎')).toBeInTheDocument();
  });

  it('the wizard sheet cannot be closed while an install runs', async () => {
    // Closing it mid-install would only bring it back with the next progress snapshot.
    renderApp({ state: 'notConfigured' });
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: '关闭' })).toBeInTheDocument();
    // From pressing install to the first progress snapshot, and while the job runs.
    for (const running of [
      { starting: true, job: null },
      { starting: false, job: runningJob },
    ]) {
      act(() => useWizardStore.setState({ step: 'install', ...running }));
      const close = within(screen.getByRole('dialog')).queryByRole('button', { name: '关闭' });
      expect(close).toBeNull();
    }
    act(() => useWizardStore.setState({ starting: false, job: null }));
  });

  it('the desktop layout is unchanged after a narrow session', () => {
    renderWithGame(<LayoutFrame />);
    fireEvent.click(screen.getByRole('tab', { name: '候选' }));
    act(() => {
      setWindow(1440, 900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.querySelector('[data-narrow]')).toBeNull();
    expect(shown()).toEqual(['header', 'winrate', 'trend', 'candidates']);
    expect(useDeviceStore.getState().settings.layout).toBeNull();
  });
});
