import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Response } from '../transport/generated/Response';
import { networks, renderSetup, setupTransport } from './testing';
import { useWizardStore } from './wizardStore';

const atNetwork = {
  step: 'network' as const,
  backend: 'cuda' as const,
  engine: 'katago-v1.18.2-cuda13.2-windows-x64',
};

const names = () => screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent);

describe('StepNetwork', () => {
  beforeEach(() => useWizardStore.getState().close());

  it('lists networks in Elo order with the top one chosen', async () => {
    const transport = setupTransport();
    renderSetup(transport, atNetwork);
    const radios = await screen.findAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName(/tf3-b11c768/);
    expect(radios[1]).toHaveAccessibleName(/zhizi-b40c768nbt/);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(transport.requests).toContainEqual({
      type: 'setupNetworks',
      engine: atNetwork.engine,
    });
  });

  it('marks a network that is already downloaded', async () => {
    const transport = setupTransport({
      setupNetworks: () => ({
        type: 'setupNetworks',
        networks: {
          ...networks,
          networks: networks.networks.map((n, i) => ({ ...n, installed: i === 1 })),
        },
      }),
    });
    renderSetup(transport, atNetwork);
    const radios = await screen.findAllByRole('radio');
    expect(radios[1].closest('label')).toHaveTextContent('已下载');
    expect(radios[0].closest('label')).not.toHaveTextContent('已下载');
  });

  it('shows Elo as a whole number, as the mockup does', async () => {
    const transport = setupTransport({
      setupNetworks: () => ({
        type: 'setupNetworks',
        networks: {
          networks: [
            {
              network: 'kata1-tf3',
              family: 'tf3',
              elo: 14638.2,
              uploaded: '2026-11-01',
              sizeBytes: 1,
              installed: false,
            },
          ],
          preselected: 'kata1-tf3',
          human: null,
        },
      }),
    });
    renderSetup(transport, atNetwork);
    expect(await screen.findByText('14638')).toBeInTheDocument();
  });

  it('puts an imported network at the top, chosen', async () => {
    const transport = setupTransport({
      setupImportNetwork: () => ({
        type: 'setupImportNetwork',
        network: { id: 'imported-0123456789abcdef', name: 'my-net', sizeBytes: 100_000_000 },
      }),
    });
    renderSetup(transport, atNetwork);
    await screen.findAllByRole('radio');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '导入权重文件' })));
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAccessibleName(/my-net/);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(useWizardStore.getState().network).toBe('imported-0123456789abcdef');
  });

  it('changes nothing when the file dialog is cancelled', async () => {
    const transport = setupTransport({
      setupImportNetwork: () => ({ type: 'setupImportNetwork', network: null }),
    });
    renderSetup(transport, atNetwork);
    await screen.findAllByRole('radio');
    const before = names();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '导入权重文件' })));
    expect(names()).toEqual(before);
    expect(useWizardStore.getState().network).toBe('tf3-b11c768-s12382M-d6533M');
  });

  it('shows an import failure inline', async () => {
    const transport = setupTransport({
      setupImportNetwork: (): Response => {
        throw { code: 'setupImportFailed', message: 'not a network' };
      },
    });
    renderSetup(transport, atNetwork);
    await screen.findAllByRole('radio');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '导入权重文件' })));
    expect(screen.getByRole('alert')).toHaveTextContent('该文件不是 KataGo 网络文件。');
  });

  it('starts the install with the licence check', async () => {
    renderSetup(setupTransport(), atNetwork);
    await screen.findAllByRole('radio');
    fireEvent.click(screen.getByRole('button', { name: '开始安装' }));
    expect(useWizardStore.getState().step).toBe('licence');
  });
});
