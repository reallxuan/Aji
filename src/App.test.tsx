import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { usePanelStore } from './app/panelStore';
import { createFakeFiles } from './platform/fakeFiles';
import { PlatformProvider } from './platform/PlatformProvider';
import { createEngineStore, EngineStoreProvider } from './engine/engineStore';
import { createI18n } from './i18n/createI18n';
import { setupTransport } from './setup/testing';
import { useWizardStore } from './setup/wizardStore';
import type { EngineState } from './transport/generated/EngineState';
import type { Response } from './transport/generated/Response';
import { TransportProvider } from './transport/TransportProvider';

function renderApp(engine: EngineState) {
  const transport = setupTransport({
    engineStatus: () => ({
      type: 'engineStatus',
      engine,
      position: '0000000000000000',
      analysis: null,
    }),
    appInfo: () => ({ type: 'appInfo', version: '0.1.0', os: 'macos', arch: 'aarch64' }),
    // Detection never answers, so the wizard stays on its first step.
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

describe('App panel switch', () => {
  beforeEach(() => {
    useWizardStore.setState({ open: false, dismissed: false, rerun: false });
    usePanelStore.setState({ view: 'main' });
  });

  it('opens the wizard with no engine, and "set up later" closes it into the no-engine panel', async () => {
    renderApp({ state: 'notConfigured' });
    expect(await screen.findByText('准备 AI 引擎')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '暂不设置' })));
    expect(screen.queryByText('准备 AI 引擎')).not.toBeInTheDocument();
    expect(screen.getByText('尚未设置引擎')).toBeInTheDocument();
    // The no-engine panel's button opens the wizard again (not a re-run).
    // The grey dot carries the same label; this is the panel's own button.
    fireEvent.click(screen.getByText('设置引擎', { selector: 'button' }));
    expect(screen.getByText('准备 AI 引擎')).toBeInTheDocument();
    expect(useWizardStore.getState().rerun).toBe(false);
  });

  it('the gear opens settings and the arrow returns', async () => {
    renderApp({ state: 'ready', version: '1.18.2' });
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '设置' })));
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关于 Aji' }));
    expect(screen.getByRole('heading', { name: '关于 Aji' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.queryByRole('heading', { name: '设置' })).not.toBeInTheDocument();
    expect(screen.getByText('未命名棋局')).toBeInTheDocument();
  });

  it('on a re-run over a working engine, offers cancel instead and returns to analysis', async () => {
    renderApp({ state: 'ready', version: '1.18.2' });
    await act(async () => {});
    expect(screen.queryByText('准备 AI 引擎')).not.toBeInTheDocument();
    act(() => useWizardStore.getState().openWizard(true));
    expect(screen.getByText('准备 AI 引擎')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暂不设置' })).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '取消' })));
    expect(screen.queryByText('准备 AI 引擎')).not.toBeInTheDocument();
  });
});
