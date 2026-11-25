import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useAddEngineStore } from '../engine/addEngineStore';
import { resetProfileStore } from '../engine/profileStore';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import type { Request } from '../transport/generated/Request';
import { ProfileList } from './ProfileList';

afterEach(() => {
  resetProfileStore();
  resetGameStore();
  useAddEngineStore.setState({ open: false });
});

const GAP = '　';
const B28 = 'kata1-b28c512nbt-s13255M';
const ZHIZI = 'kata1-zhizi-b40c768nbt-s11272M';

const managed = (
  id: string,
  name: string,
  network: string,
  current: boolean,
  visitsPerSecond: number | null,
): ProfileSummary => ({
  id,
  name,
  current,
  source: {
    kind: 'managed',
    engine: 'katago-v1.16.4-metal',
    version: '1.16.4',
    backend: 'metal',
    network,
    networkName: network,
    threads: 8,
    visitsPerSecond,
  },
});

const PROFILES: ProfileSummary[] = [
  managed('eng/b28', 'b28 主力', B28, true, 410.2),
  managed('eng/zhizi', 'zhizi b40', ZHIZI, false, null),
  {
    id: 'own-1',
    name: 'Homebrew KataGo',
    current: false,
    source: {
      kind: 'own',
      katago: '/opt/homebrew/bin/katago',
      model: `/models/${B28}.bin.gz`,
      config: '/opt/homebrew/share/a.cfg',
    },
  },
];

function mount() {
  const requests: Request[] = [];
  renderWithGame(<ProfileList onError={() => {}} />, {
    answer: (request) => {
      requests.push(request);
      if (request.type === 'engineProfiles')
        return { type: 'engineProfiles', profiles: PROFILES, devOverride: false };
      if (request.type.startsWith('engineProfile')) return { type: 'ok' };
      return undefined;
    },
  });
  return { sent: (type: Request['type']) => requests.filter((r) => r.type === type) };
}

const row = (name: string) => screen.getByRole('radio', { name }).closest('[data-profile]')!;

async function openMore(name: string) {
  const more = within(row(name) as HTMLElement).getByRole('button', { name: '更多' });
  await act(async () => {
    fireEvent.keyDown(more, { key: 'Enter' });
  });
  return screen.getByRole('menu');
}

it('lists each profile with its build, network, threads and speed', async () => {
  mount();
  await screen.findByRole('radio', { name: 'b28 主力' });
  expect(row('b28 主力')).toHaveTextContent(
    `KataGo 1.16.4（Metal）${GAP}${B28}${GAP}8 线程，约 410 次/秒`,
    { normalizeWhitespace: false },
  );
  expect(row('zhizi b40')).toHaveTextContent(
    `KataGo 1.16.4（Metal）${GAP}${ZHIZI}${GAP}8 线程，未测速`,
    { normalizeWhitespace: false },
  );
  expect(row('Homebrew KataGo')).toHaveTextContent(
    `Homebrew KataGo自己的文件/opt/homebrew/bin/katago${GAP}线程由配置文件决定`,
    { normalizeWhitespace: false },
  );
  expect(screen.getByRole('radio', { name: 'b28 主力' })).toBeChecked();
});

it('switches when another radio is chosen', async () => {
  const { sent } = mount();
  await act(async () => {
    fireEvent.click(await screen.findByRole('radio', { name: 'zhizi b40' }));
  });
  await waitFor(() =>
    expect(sent('engineProfileSwitch')).toEqual([{ type: 'engineProfileSwitch', id: 'eng/zhizi' }]),
  );
});

it('renames in place: Enter saves, Esc cancels', async () => {
  const { sent } = mount();
  await screen.findByRole('radio', { name: 'zhizi b40' });
  let menu = await openMore('zhizi b40');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: '重命名' }));
  });
  let field = screen.getByRole('textbox', { name: '配置名字' });
  expect(field).toHaveValue('zhizi b40');
  fireEvent.change(field, { target: { value: '大模型' } });
  await act(async () => fireEvent.keyDown(field, { key: 'Escape' }));
  expect(screen.queryByRole('textbox', { name: '配置名字' })).toBeNull();
  expect(sent('engineProfileRename')).toEqual([]);

  menu = await openMore('zhizi b40');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: '重命名' }));
  });
  field = screen.getByRole('textbox', { name: '配置名字' });
  fireEvent.change(field, { target: { value: '大模型' } });
  await act(async () => fireEvent.keyDown(field, { key: 'Enter' }));
  expect(sent('engineProfileRename')).toEqual([
    { type: 'engineProfileRename', id: 'eng/zhizi', name: '大模型' },
  ]);
});

it('an Enter that ends an input-method composition does not save the name', async () => {
  const { sent } = mount();
  await screen.findByRole('radio', { name: 'zhizi b40' });
  const menu = await openMore('zhizi b40');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: '重命名' }));
  });
  const field = screen.getByRole('textbox', { name: '配置名字' });
  fireEvent.change(field, { target: { value: 'da' } });
  await act(async () => fireEvent.keyDown(field, { key: 'Enter', isComposing: true }));
  expect(sent('engineProfileRename')).toEqual([]);
  expect(screen.getByRole('textbox', { name: '配置名字' })).toHaveValue('da');
});

it('puts the cursor in the name field, its text selected, once the menu closes', async () => {
  mount();
  await screen.findByRole('radio', { name: 'zhizi b40' });
  const menu = await openMore('zhizi b40');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: '重命名' }));
  });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  const field = screen.getByRole<HTMLInputElement>('textbox', { name: '配置名字' });
  await waitFor(() => expect(field).toHaveFocus());
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'zhizi b40'.length]);
});

it('cannot remove the current profile, and removes another', async () => {
  const { sent } = mount();
  await screen.findByRole('radio', { name: 'b28 主力' });
  let menu = await openMore('b28 主力');
  const current = within(menu).getByRole('menuitem', { name: '移除' });
  expect(current).toHaveAttribute('aria-disabled', 'true');
  expect(current).toHaveAttribute('title', '当前配置不能移除，请先切换');
  await act(async () => fireEvent.keyDown(menu, { key: 'Escape' }));

  menu = await openMore('Homebrew KataGo');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: '移除' }));
  });
  expect(sent('engineProfileRemove')).toEqual([{ type: 'engineProfileRemove', id: 'own-1' }]);
});

it('opens 添加引擎 from under the list', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '添加引擎…' }));
  expect(useAddEngineStore.getState().open).toBe(true);
});
