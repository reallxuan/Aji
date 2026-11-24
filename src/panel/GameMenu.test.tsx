import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { GameMenu } from './GameMenu';

afterEach(() => resetGameStore());

async function openMenu(title: string) {
  const trigger = screen.getByRole('button', { name: title });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
  return screen.getByRole('menu');
}

async function openSub(menu: HTMLElement, name: string) {
  const item = within(menu).getByRole('menuitem', { name });
  await act(async () => {
    item.focus();
    fireEvent.keyDown(item, { key: 'ArrowRight' });
  });
  return screen.getAllByRole('menu').at(-1) as HTMLElement;
}

it('lists the items with macOS shortcuts, save-as disabled for an empty game', async () => {
  renderWithGame(<GameMenu />, { snapshot: makeSnapshot({ hasMoves: false }), os: 'macos' });
  await act(async () => {});
  const menu = await openMenu('未命名棋局');
  expect(within(menu).getByRole('menuitem', { name: /打开棋谱…/ })).toHaveTextContent('⌘O');
  const save = within(menu).getByRole('menuitem', { name: /另存为…/ });
  expect(save).toHaveTextContent('⇧⌘S');
  expect(save).toHaveAttribute('data-disabled');
});

it('shows Ctrl shortcuts elsewhere', async () => {
  renderWithGame(<GameMenu />, { snapshot: makeSnapshot({ hasMoves: true }), os: 'windows' });
  await act(async () => {});
  const menu = await openMenu('未命名棋局');
  expect(within(menu).getByRole('menuitem', { name: /打开棋谱…/ })).toHaveTextContent('Ctrl+O');
  expect(within(menu).getByRole('menuitem', { name: /另存为…/ })).not.toHaveAttribute(
    'data-disabled',
  );
});

it('starts a new game of the chosen size', async () => {
  const { requests } = renderWithGame(<GameMenu />);
  const sizes = await openSub(await openMenu('未命名棋局'), '新建棋局');
  await act(async () => {
    fireEvent.click(within(sizes).getByRole('menuitem', { name: /13 路/ }));
  });
  expect(requests).toContainEqual({ type: 'gameNew', size: 13 });
});

it('lists recent files in order, greys a missing one, and opens the chosen entry', async () => {
  const { requests } = renderWithGame(<GameMenu />, {
    files: {
      files: { '/g/a.sgf': '(;B[pd])', '/g/b.sgf': '(;B[dd])' },
      recent: ['/g/a.sgf', '/g/gone.sgf', '/g/b.sgf'],
    },
  });
  const recent = await openSub(await openMenu('未命名棋局'), '打开最近');
  const items = within(recent).getAllByRole('menuitem');
  expect(items.map((i) => i.getAttribute('title'))).toEqual([
    '/g/a.sgf',
    '/g/gone.sgf',
    '/g/b.sgf',
    null,
  ]);
  expect(items[1]).toHaveTextContent('已移动或删除');
  expect(items[1]).toHaveAttribute('data-missing');
  expect(items[3]).toHaveTextContent('清除最近记录');
  await act(async () => {
    fireEvent.click(items[2]);
  });
  expect(requests).toContainEqual(expect.objectContaining({ type: 'gameOpen', name: 'b.sgf' }));
});

it('shows an empty recent list', async () => {
  renderWithGame(<GameMenu />);
  const recent = await openSub(await openMenu('未命名棋局'), '打开最近');
  expect(recent).toHaveTextContent('暂无最近打开的棋谱');
});

it('does not reopen on ↓ right after choosing an item', async () => {
  renderWithGame(<GameMenu />, { snapshot: makeSnapshot({ hasMoves: true }), os: 'windows' });
  await act(async () => {});
  const menu = await openMenu('未命名棋局');
  const open = within(menu).getByRole('menuitem', { name: /打开棋谱…/ });
  await act(async () => {
    fireEvent.click(open);
  });
  expect(screen.queryByRole('menu')).toBeNull();
  const trigger = screen.getByRole('button', { name: '未命名棋局' });
  expect(document.activeElement).not.toBe(trigger);
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowDown' });
  });
  expect(screen.queryByRole('menu')).toBeNull();
});

it('game menu has the m2 items in order', async () => {
  const { requests } = renderWithGame(<GameMenu />, {
    snapshot: makeSnapshot({ hasMoves: true }),
    answer: (request) => (request.type === 'cacheClear' ? { type: 'ok' } : undefined),
  });
  await act(async () => {});
  const menu = await openMenu('未命名棋局');
  const names = within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);
  expect(names).toEqual(
    [
      '新建棋局',
      '打开棋谱…',
      '打开最近',
      '另存为…',
      '棋局信息',
      '分析全局…',
      '清除分析结果',
      '终局点目',
    ].map((name) => expect.stringMatching(new RegExp(`^${name}`))),
  );
  const clear = await openSub(menu, '清除分析结果');
  expect(
    within(clear)
      .getAllByRole('menuitem')
      .map((i) => i.textContent),
  ).toEqual(['本局面', '整局']);
  await act(async () => {
    fireEvent.click(within(clear).getByRole('menuitem', { name: '整局' }));
  });
  expect(requests).toContainEqual({ type: 'cacheClear', scope: 'game' });
});

it('analyse game opens its panel under the title, with 开始 focused', async () => {
  const { useJobPanelStore } = await import('../job/jobPanelStore');
  renderWithGame(<GameMenu />, { snapshot: makeSnapshot({ hasMoves: true }) });
  await act(async () => {});
  const menu = await openMenu('未命名棋局');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: '分析全局…' }));
  });
  const start = screen.getByRole('button', { name: '开始' });
  expect(start).toHaveFocus();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
  });
  expect(screen.queryByRole('button', { name: '开始' })).toBeNull();
  expect(useJobPanelStore.getState().open).toBe(false);
});

it('终局点目 starts scoring on the position', async () => {
  const { resetScoringStore, useScoringStore } = await import('../scoring/scoringStore');
  const side = { stones: 0, territory: 0, dead: 0, prisoners: 0, total: 0 };
  const { requests } = renderWithGame(<GameMenu />, {
    snapshot: makeSnapshot({ hasMoves: true }),
    answer: (request) =>
      request.type === 'gameScore'
        ? {
            type: 'score',
            suggestedDead: [],
            black: side,
            white: side,
            komi: 7.5,
            margin: -7.5,
            owners: [],
            openByOwnership: false,
          }
        : undefined,
  });
  await act(async () => {});
  const menu = await openMenu('未命名棋局');
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: /终局点目/ }));
  });
  expect(useScoringStore.getState().active).toBe(true);
  expect(requests).toContainEqual({ type: 'gameScore', mode: { kind: 'final', dead: [] } });
  resetScoringStore();
});

it('offers sizes 5 through 18 under other sizes', async () => {
  const { requests } = renderWithGame(<GameMenu />);
  const menu = await openSub(await openSub(await openMenu('未命名棋局'), '新建棋局'), '其他路数');
  expect(within(menu).getAllByRole('menuitem')).toHaveLength(14);
  await act(async () => fireEvent.click(within(menu).getByRole('menuitem', { name: '18 路' })));
  expect(requests).toContainEqual({ type: 'gameNew', size: 18 });
});
it('opens game information from the title as a full sheet in a narrow frame', async () => {
  renderWithGame(<GameMenu narrow />);
  await act(async () =>
    fireEvent.click(
      within(await openMenu('未命名棋局')).getByRole('menuitem', { name: '棋局信息' }),
    ),
  );
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByLabelText('棋局名称')).toBeInTheDocument();
});
