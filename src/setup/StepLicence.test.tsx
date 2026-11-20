import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from '../transport/generated/Request';
import {
  chosen,
  cudaLicences,
  nvidiaRecommendation,
  renderSetup,
  setupTransport,
  versions,
} from './testing';
import { useWizardStore } from './wizardStore';

const openExternal = vi.fn<(url: string) => Promise<void>>(async () => {});
vi.mock('../platform/openExternal', () => ({ openExternal: (url: string) => openExternal(url) }));

const installs = (requests: Request[]) => requests.filter((r) => r.type === 'setupInstall');

function licenceTransport() {
  return setupTransport({
    setupLicences: () => ({ type: 'setupLicences', licences: cudaLicences, accepted: [] }),
    setupVersions: (request) => ({
      type: 'setupVersions',
      versions:
        request.type === 'setupVersions' && request.backend === 'directml'
          ? [
              {
                ...versions[0],
                engine: 'katago-v1.18.2-directml-windows-x64',
                runtimeBytes: null,
                downloadBytes: 24 * 1024 * 1024,
              },
            ]
          : versions,
    }),
  });
}

describe('StepLicence', () => {
  beforeEach(() => {
    useWizardStore.getState().close();
    openExternal.mockClear();
  });

  it('lists each licence with the size it covers and a link to read it', async () => {
    renderSetup(licenceTransport(), { step: 'licence', ...chosen });
    expect(await screen.findByText('需要接受许可协议')).toBeInTheDocument();
    const row = screen.getByText('CUDA Toolkit EULA').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('1000 MB');
    fireEvent.click(screen.getAllByRole('button', { name: /查看/ })[1]);
    expect(openExternal).toHaveBeenCalledWith('https://docs.nvidia.com/deeplearning/cudnn/sla/');
  });

  it('names each component a licence covers, with its version and size', async () => {
    renderSetup(licenceTransport(), { step: 'licence', ...chosen });
    const cuda = (await screen.findByText('CUDA Toolkit EULA')).closest('li') as HTMLElement;
    expect(within(cuda).getByText('cudart 13.2').closest('li')).toHaveTextContent('600 MB');
    expect(within(cuda).getByText('cublas 13.2').closest('li')).toHaveTextContent('400 MB');
    const cudnn = screen.getByText('cuDNN Software License Agreement').closest('li') as HTMLElement;
    expect(within(cudnn).getByText('cudnn 9.8')).toBeInTheDocument();
    expect(within(cudnn).queryByText('cudart 13.2')).toBeNull();
  });

  it('enables install only once the box is ticked, then sends the licence hashes', async () => {
    const transport = licenceTransport();
    renderSetup(transport, { step: 'licence', ...chosen });
    const accept = await screen.findByRole('button', { name: '接受并安装' });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我已年满法定年龄/ }));
    expect(accept).toBeEnabled();
    await act(async () => fireEvent.click(accept));
    expect(installs(transport.requests)).toEqual([
      {
        type: 'setupInstall',
        engine: chosen.engine,
        network: chosen.network,
        acceptLicences: ['aa'.repeat(32), 'bb'.repeat(32)],
        benchmark: false,
      },
    ]);
  });

  it('declining downloads nothing and offers the next backend (panel A2)', async () => {
    const transport = licenceTransport();
    renderSetup(transport, { step: 'licence', recommendation: nvidiaRecommendation, ...chosen });
    const decline = await screen.findByRole('button', { name: '不接受' });
    await act(async () => fireEvent.click(decline));
    expect(installs(transport.requests)).toHaveLength(0);
    expect(await screen.findByText('此后端需要的许可协议尚未接受。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改用 DirectML（24 MB）' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('starts at once when every licence is already accepted', async () => {
    const transport = setupTransport({
      setupLicences: () => ({
        type: 'setupLicences',
        licences: cudaLicences,
        accepted: cudaLicences.map((l) => l.textSha256),
      }),
    });
    renderSetup(transport, { step: 'licence', ...chosen }, { strict: true });
    await waitFor(() => expect(installs(transport.requests)).toHaveLength(1));
    expect(installs(transport.requests)[0]).toMatchObject({ acceptLicences: [] });
    expect(useWizardStore.getState().step).toBe('install');
  });
});
