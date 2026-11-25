import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { usePanelStore } from '../app/panelStore';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { resetJobStore, useJobStore } from '../job/jobStore';
import { middleTruncate } from '../panel/EngineCard';
import { PanelHeader } from '../panel/PanelHeader';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import type { Request } from '../transport/generated/Request';
import { useAddEngineStore } from './addEngineStore';
import { ProfileChip } from './ProfileChip';
import { resetProfileStore, useProfileStore } from './profileStore';
import { SwitchConfirm } from './SwitchConfirm';

afterEach(() => {
  resetProfileStore();
  resetJobStore();
  resetGameStore();
  useAddEngineStore.setState({ open: false });
  usePanelStore.setState({ view: 'main', section: null });
});

const B28 = 'kata1-b28c512nbt-s13255M';
const ZHIZI = 'kata1-zhizi-b40c768nbt-s11272M';
/** The ideographic space between a profile's network and its speed, as the mockup has it. */
const GAP = '　';

const managed = (
  id: string,
  network: string,
  current: boolean,
  visitsPerSecond: number | null,
  name = network,
): ProfileSummary => ({
  id,
  name,
  current,
  source: {
    kind: 'managed',
    engine: 'eng',
    version: '1.18.2',
    backend: 'metal',
    network,
    networkName: network,
    threads: 16,
    visitsPerSecond,
  },
});

const PROFILES: ProfileSummary[] = [
  managed('eng/b28', B28, true, 410.4),
  managed('eng/zhizi', ZHIZI, false, null, 'zhizi b40'),
  {
    id: 'own-1',
    name: 'Homebrew KataGo',
    current: false,
    source: {
      kind: 'own',
      katago: '/opt/homebrew/bin/katago',
      model: `/Users/me/models/${B28}.bin.gz`,
      config: '/opt/homebrew/share/a.cfg',
    },
  },
];

function mount(devOverride = false) {
  useProfileStore.setState({ profiles: PROFILES, devOverride });
  const requests: Request[] = [];
  renderWithGame(
    <>
      <ProfileChip />
      <SwitchConfirm />
    </>,
    {
      answer: (request) => {
        requests.push(request);
        if (request.type === 'engineProfileSwitch') return { type: 'ok' };
        if (request.type === 'engineProfiles')
          return { type: 'engineProfiles', profiles: PROFILES, devOverride };
        return undefined;
      },
    },
  );
  return { switched: () => requests.filter((r) => r.type === 'engineProfileSwitch') };
}

async function openMenu(name: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
  });
  return screen.getByRole('menu');
}

it('names the current profile, cut in the middle to 16 characters', () => {
  mount();
  expect(middleTruncate(B28, 16)).toHaveLength(16);
  expect(screen.getByRole('button', { name: middleTruncate(B28, 16) })).toBeInTheDocument();
});

it('lists the profiles with their network and speed, and the engine actions', async () => {
  mount();
  const menu = await openMenu(middleTruncate(B28, 16));
  expect(within(menu).getByText('引擎配置')).toBeInTheDocument();
  const items = within(menu).getAllByRole('menuitemradio');
  expect(items.map((i) => i.textContent)).toEqual([
    `${B28}${B28}${GAP}约 410 次/秒`,
    `zhizi b40${ZHIZI}${GAP}未测速`,
    `Homebrew KataGo自己的文件${GAP}${B28}.bin.gz`,
  ]);
  expect(items[0]).toHaveAttribute('aria-checked', 'true');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: '添加引擎…' }));
  });
  expect(useAddEngineStore.getState().open).toBe(true);
});

it('opens Settings at the engine section from 管理引擎…', async () => {
  mount();
  const menu = await openMenu(middleTruncate(B28, 16));
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: '管理引擎…' }));
  });
  expect(usePanelStore.getState()).toMatchObject({ view: 'settings', section: 'engine' });
});

it('switches at once when no job runs', async () => {
  const { switched } = mount();
  const menu = await openMenu(middleTruncate(B28, 16));
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /zhizi b40/ }));
  });
  await waitFor(() =>
    expect(switched()).toEqual([{ type: 'engineProfileSwitch', id: 'eng/zhizi' }]),
  );
});

it('asks first while a whole-game job runs, and only 切换 switches', async () => {
  const { switched } = mount();
  useJobStore.getState().apply({
    state: 'running',
    done: 64,
    total: 213,
    boostDone: 0,
    boostTotal: 0,
    working: null,
    queued: [],
    etaSeconds: null,
  });
  const pick = async () => {
    const menu = await openMenu(middleTruncate(B28, 16));
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: /zhizi b40/ }));
    });
    return screen.getByRole('dialog');
  };

  let dialog = await pick();
  expect(within(dialog).getByText('切换到 zhizi b40')).toBeInTheDocument();
  expect(dialog).toHaveTextContent('已完成 64 / 213');
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(switched()).toEqual([]);

  dialog = await pick();
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: '切换' }));
  });
  await waitFor(() =>
    expect(switched()).toEqual([{ type: 'engineProfileSwitch', id: 'eng/zhizi' }]),
  );
});

it('with a development engine, names it and disables the profiles', async () => {
  mount(true);
  const menu = await openMenu('开发引擎');
  const entry = within(menu).getByRole('menuitemradio', { name: '开发引擎 (settings.json)' });
  expect(entry).toHaveAttribute('aria-checked', 'true');
  expect(entry).toHaveAttribute('aria-disabled', 'true');
  for (const item of within(menu).getAllByRole('menuitemradio').slice(1))
    expect(item).toHaveAttribute('aria-disabled', 'true');
});

it('sits in the desktop header, and not in the compact phone header', async () => {
  useProfileStore.setState({ profiles: PROFILES, devOverride: false });
  const { unmount } = renderWithGame(<PanelHeader />);
  await act(async () => {});
  expect(screen.getByRole('button', { name: middleTruncate(B28, 16) })).toBeInTheDocument();
  unmount();
  renderWithGame(<PanelHeader compact />);
  await act(async () => {});
  expect(screen.queryByRole('button', { name: middleTruncate(B28, 16) })).toBeNull();
});

it('shows nothing when there are no profiles and no development engine', () => {
  renderWithGame(<ProfileChip />);
  expect(screen.queryByRole('button')).toBeNull();
});
