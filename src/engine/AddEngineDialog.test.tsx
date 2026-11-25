import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { initialWizard, useWizardStore } from '../setup/wizardStore';
import { useSetupProgress } from '../setup/useSetupProgress';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import type { NetworkChoice } from '../transport/generated/NetworkChoice';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import type { Request } from '../transport/generated/Request';
import { TransportError } from '../transport/transport';
import { AddEngineDialog } from './AddEngineDialog';
import { resetAddEngineStore, useAddEngineStore } from './addEngineStore';
import { resetProfileStore, useProfileStore } from './profileStore';

afterEach(() => {
  resetProfileStore();
  resetAddEngineStore();
  resetGameStore();
  useWizardStore.setState(initialWizard);
});

const ENGINE = 'katago-v1.18.2-metal-macos-arm64';
const B28 = 'kata1-b28c512nbt-s13255M';
const ZHIZI = 'kata1-zhizi-b40c768nbt-s11272M';

const managed: ProfileSummary = {
  id: `${ENGINE}/${B28}`,
  name: B28,
  current: true,
  source: {
    kind: 'managed',
    engine: ENGINE,
    version: '1.18.2',
    backend: 'metal',
    network: B28,
    networkName: B28,
    threads: 8,
    visitsPerSecond: null,
  },
};
const own: ProfileSummary = {
  id: 'own-1',
  name: 'brew',
  current: true,
  source: { kind: 'own', katago: '/k', model: '/m.bin.gz', config: '/a.cfg' },
};

const choice = (network: string, installed: boolean): NetworkChoice => ({
  network,
  family: 'kata1',
  elo: 13000,
  uploaded: '2025-01-01',
  sizeBytes: 330 * 1024 * 1024,
  installed,
});

const job = (network: string, outcome: JobSnapshot['outcome']): JobSnapshot => ({
  id: 3,
  engine: ENGINE,
  backend: 'metal',
  network,
  tasks: [
    { task: 'engine', state: { state: 'reused' } },
    {
      task: 'network',
      state: outcome ? { state: 'done' } : { state: 'running', done: 1, total: 4 },
    },
    { task: 'testQuery', state: { state: 'waiting' } },
  ],
  outcome,
  measures: false,
  benchmark: null,
});

function Harness() {
  useSetupProgress();
  return <AddEngineDialog />;
}

function mount(
  profiles: ProfileSummary[],
  answers: Partial<Record<Request['type'], (request: Request) => unknown>> = {},
) {
  useProfileStore.setState({ profiles, devOverride: false });
  useAddEngineStore.getState().setOpen(true);
  const requests: Request[] = [];
  const harness = renderWithGame(<Harness />, {
    answer: (request) => {
      requests.push(request);
      const answer = answers[request.type];
      if (answer) return answer(request) as never;
      switch (request.type) {
        case 'setupNetworks':
          return {
            type: 'setupNetworks',
            networks: {
              networks: [choice(ZHIZI, false), choice(B28, true)],
              preselected: ZHIZI,
              human: null,
            },
          };
        case 'setupInstall':
          return { type: 'ok' };
        case 'setupStatus':
          return { type: 'setupStatus', job: null };
        case 'engineProfiles':
          return { type: 'engineProfiles', profiles, devOverride: false };
        default:
          return undefined;
      }
    },
  });
  return { ...harness, sent: (type: Request['type']) => requests.filter((r) => r.type === type) };
}

const dialog = () => screen.getByRole('dialog');
const segment = (name: string) =>
  act(async () => {
    fireEvent.click(within(dialog()).getByRole('radio', { name }));
  });

it('downloads a network for the current build, with a network already in use not selectable', async () => {
  const { transport, sent } = mount([managed]);
  expect(await within(dialog()).findByText('使用 KataGo 1.18.2（Metal）')).toBeInTheDocument();
  expect(sent('setupNetworks')).toEqual([{ type: 'setupNetworks', engine: ENGINE }]);
  const inUse = within(dialog()).getByRole('radio', { name: new RegExp(B28) });
  expect(inUse).toBeDisabled();
  expect(inUse.closest('label')).toHaveTextContent('已有');

  await act(async () => {
    fireEvent.click(within(dialog()).getByRole('radio', { name: new RegExp(ZHIZI) }));
  });
  await act(async () => {
    fireEvent.click(within(dialog()).getByRole('button', { name: '下载并使用' }));
  });
  expect(sent('setupInstall')).toEqual([
    { type: 'setupInstall', engine: ENGINE, network: ZHIZI, acceptLicences: [], benchmark: false },
  ]);

  // The progress shows here, not in the wizard, until the job ends.
  act(() => transport.emit({ type: 'setupProgress', job: job(ZHIZI, null) }));
  expect(useWizardStore.getState().open).toBe(false);
  expect(within(dialog()).getByRole('progressbar', { name: '权重' })).toBeInTheDocument();
  act(() => transport.emit({ type: 'setupProgress', job: job(ZHIZI, { outcome: 'installed' }) }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent('engineProfiles').length).toBeGreaterThan(0);
});

it('imports a network file, then installs it with the same build', async () => {
  const { sent } = mount([managed], {
    setupImportNetwork: () => ({
      type: 'setupImportNetwork',
      network: { id: 'imported-0123456789abcdef', name: 'my-net', sizeBytes: 98_000_000 },
    }),
  });
  await within(dialog()).findByText('使用 KataGo 1.18.2（Metal）');
  await segment('导入权重文件');
  await act(async () => {
    fireEvent.click(within(dialog()).getByRole('button', { name: '选择权重文件…' }));
  });
  await waitFor(() =>
    expect(sent('setupInstall')).toEqual([
      {
        type: 'setupInstall',
        engine: ENGINE,
        network: 'imported-0123456789abcdef',
        acceptLicences: [],
        benchmark: false,
      },
    ]),
  );
});

it.each([
  ['katago', 'missing', 'KataGo 程序', '找不到这个文件。'],
  ['model', 'notKatago', '权重', '这不是 KataGo 程序。'],
  ['config', 'unreadable', '配置文件', '读不了这个文件。'],
] as const)('marks the %s field when the check finds it %s', async (file, problem, label, text) => {
  mount([managed], {
    setupPickFile: (request) => ({
      type: 'setupPickFile',
      path: request.type === 'setupPickFile' ? `/picked/${request.purpose}` : null,
    }),
    engineProfileAddOwn: () => {
      throw new TransportError('engineOwnFile', 'refused', `${file}:${problem}`);
    },
  });
  await segment('使用自己的 KataGo');
  for (const name of ['KataGo 程序', '权重', '配置文件']) {
    const field = within(dialog()).getByRole('textbox', { name });
    await act(async () => {
      fireEvent.click(within(field.closest('[data-field]') as HTMLElement).getByRole('button'));
    });
  }
  expect(within(dialog()).getByRole('textbox', { name: '权重' })).toHaveValue('/picked/model');
  await act(async () => {
    fireEvent.click(within(dialog()).getByRole('button', { name: '检查并添加' }));
  });
  const field = within(dialog()).getByRole('textbox', { name: label });
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(field.closest('[data-field]')).toHaveTextContent(text);
});

it('adds one’s own KataGo and closes', async () => {
  const added = { ...own, name: 'Homebrew KataGo' };
  const { sent } = mount([managed], {
    engineProfileAddOwn: () => ({
      type: 'engineProfiles',
      profiles: [{ ...managed, current: false }, added],
      devOverride: false,
    }),
  });
  await segment('使用自己的 KataGo');
  const type = (name: string, value: string) =>
    fireEvent.change(within(dialog()).getByRole('textbox', { name }), { target: { value } });
  type('KataGo 程序', '/opt/homebrew/bin/katago');
  type('权重', '/m/b28.bin.gz');
  type('配置文件', '/opt/homebrew/share/a.cfg');
  type('名字', 'Homebrew KataGo');
  await act(async () => {
    fireEvent.click(within(dialog()).getByRole('button', { name: '检查并添加' }));
  });
  expect(sent('engineProfileAddOwn')).toEqual([
    {
      type: 'engineProfileAddOwn',
      katago: '/opt/homebrew/bin/katago',
      model: '/m/b28.bin.gz',
      config: '/opt/homebrew/share/a.cfg',
      name: 'Homebrew KataGo',
    },
  ]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(useProfileStore.getState().profiles.find((p) => p.current)?.name).toBe('Homebrew KataGo');
});

it('with no installed build, downloading and importing open the wizard instead', async () => {
  mount([own]);
  const open = within(dialog()).getByRole('button', { name: '打开设置向导' });
  await act(async () => fireEvent.click(open));
  expect(useWizardStore.getState().open).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('with an own profile current, downloads for the newest installed build', async () => {
  const older = {
    ...managed,
    id: 'old/net',
    current: false,
    source: { ...managed.source, engine: 'katago-v1.16.4-metal-macos-arm64', version: '1.16.4' },
  } as ProfileSummary;
  const { sent } = mount([older, { ...managed, current: false }, own]);
  expect(await within(dialog()).findByText('使用 KataGo 1.18.2（Metal）')).toBeInTheDocument();
  expect(sent('setupNetworks')).toEqual([{ type: 'setupNetworks', engine: ENGINE }]);
});
