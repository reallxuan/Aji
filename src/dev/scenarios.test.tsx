import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { usePanelStore } from '../app/panelStore';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { createI18n } from '../i18n/createI18n';
import { useSettingsStore } from '../settings/settingsStore';
import { initialWizard, useWizardStore } from '../setup/wizardStore';
import { TransportProvider } from '../transport/TransportProvider';
import { SCENARIOS, scenarioTransport } from './scenarios';

vi.mock('../platform/openExternal', () => ({ openExternal: async () => {} }));

function mount(name: string) {
  const transport = scenarioTransport(name, { tick: 1 });
  if (!transport) throw new Error(`no scenario ${name}`);
  render(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={createEngineStore()}>
          <App />
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
});
