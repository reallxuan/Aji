import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chosen,
  downloadFailedJob,
  driverFailedJob,
  gpuFailedJob,
  renderSetup,
  setupTransport,
} from './testing';
import { useWizardStore } from './wizardStore';

const openExternal = vi.fn<(url: string) => Promise<void>>(async () => {});
vi.mock('../platform/openExternal', () => ({ openExternal: (url: string) => openExternal(url) }));

const footerButtons = () =>
  within(screen.getByRole('contentinfo'))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('FailurePanel', () => {
  beforeEach(() => {
    useWizardStore.getState().close();
    openExternal.mockClear();
  });

  it('A1 names both driver versions, links to the driver page, and makes Retry the main button', () => {
    renderSetup(setupTransport(), { step: 'install', ...chosen, job: driverFailedJob });
    expect(screen.getByText('CUDA 无法使用')).toBeInTheDocument();
    expect(screen.getByText(/566\.36/)).toHaveTextContent('580.00');
    fireEvent.click(screen.getByRole('button', { name: /下载 NVIDIA 驱动/ }));
    expect(openExternal).toHaveBeenCalledWith('https://www.nvidia.com/drivers/');
    expect(footerButtons()).toEqual(['返回选择后端', '改用 DirectML（24 MB）', '重试']);
    expect(screen.getByRole('button', { name: '重试' })).toHaveAttribute('data-variant', 'default');
  });

  it('Retry detects again, then installs the same engine and network', async () => {
    const transport = setupTransport();
    renderSetup(transport, { step: 'install', ...chosen, job: driverFailedJob });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试' })));
    await waitFor(() => expect(transport.requests.map((r) => r.type)).toContain('setupInstall'));
    const types = transport.requests.map((r) => r.type);
    expect(types.indexOf('setupDetect')).toBeLessThan(types.indexOf('setupInstall'));
    expect(transport.requests).toContainEqual({ type: 'setupDetect', refresh: true });
    expect(transport.requests).toContainEqual({
      type: 'setupInstall',
      engine: chosen.engine,
      network: chosen.network,
      acceptLicences: [],
    });
  });

  it('a double click on Retry sends one setupInstall (Review Focus 2)', async () => {
    const transport = setupTransport();
    renderSetup(transport, { step: 'install', ...chosen, job: driverFailedJob });
    const retry = screen.getByRole('button', { name: '重试' });
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    await waitFor(() => expect(useWizardStore.getState().step).toBe('install'));
    expect(transport.requests.filter((r) => r.type === 'setupInstall')).toHaveLength(1);
  });

  it('A2 makes the fallback the main button, and accepting installs the offered engine', async () => {
    const transport = setupTransport();
    renderSetup(transport, { step: 'install', ...chosen, job: gpuFailedJob });
    expect(screen.getByText('KataGo 无法通过此后端使用显卡。')).toBeInTheDocument();
    expect(footerButtons()).toEqual(['返回选择后端', '重试', '改用 DirectML（24 MB）']);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '改用 DirectML（24 MB）' })),
    );
    await waitFor(() =>
      expect(transport.requests).toContainEqual({
        type: 'setupInstall',
        engine: 'katago-v1.18.2-directml-windows-x64',
        network: chosen.network,
        acceptLicences: [],
      }),
    );
    expect(useWizardStore.getState().backend).toBe('directml');
  });

  it('B has Retry and Back, with Set up later on the left', () => {
    renderSetup(setupTransport(), { step: 'install', ...chosen, job: downloadFailedJob });
    expect(screen.getByText('安装没有完成')).toBeInTheDocument();
    expect(footerButtons()).toEqual(['暂不设置', '返回', '重试']);
  });

  it('folds out the stderr tail', () => {
    renderSetup(setupTransport(), { step: 'install', ...chosen, job: gpuFailedJob });
    expect(screen.queryByText('file: cudahelpers.cu line: 54')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /KataGo 最后的输出/ }));
    expect(screen.getByText(/file: cudahelpers\.cu line: 54/)).toBeInTheDocument();
  });
});
