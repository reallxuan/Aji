import { panelsOf } from '../layout/model';
import { presetLayout } from '../layout/presets';
import { useLayout, setLayout } from '../layout/useLayout';
import type { Response } from '../transport/generated/Response';
import { useCommentFocus } from '../comments/commentFocus';
import { useDeviceStore } from '../device/deviceStore';

import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { useTreeStore } from '../game/treeStore';
import { record } from './testing';
import { TreePanel } from './TreePanel';

beforeEach(() => {
  resetGameStore();
  useTreeStore.setState({ tree: record([null, 0, 1, 0]) });
});
const node = (id: number) => document.querySelector<SVGGElement>(`[data-tree-node="${id}"]`)!;

it.each([
  [200, 100, false],
  [100, 200, true],
  [160, 160, false],
] as const)('tree turns with its panel %i × %i', (width, height, vertical) => {
  renderWithGame(<TreePanel width={width} height={height} />);
  const coords = (id: number) => node(id).getAttribute('transform')!.match(/\d+/g);
  expect(coords(1)![vertical ? 0 : 1]).toBe(coords(0)![vertical ? 0 : 1]);
  expect(coords(1)![vertical ? 1 : 0]).not.toBe(coords(0)![vertical ? 1 : 0]);
});
it('click a node navigates, and an outdated tree cannot navigate', async () => {
  const { requests } = renderWithGame(<TreePanel width={240} height={160} />);
  await act(async () => fireEvent.click(node(3)));
  expect(requests).toContainEqual({ type: 'gameNavigate', to: { node: 3 } });
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 110, treeRevision: 2 })));
  expect(node(3)).toBeNull();
});
it('node menu disables items on the main line', () => {
  renderWithGame(<TreePanel width={240} height={160} />);
  fireEvent.contextMenu(node(1));
  for (const name of ['设为主分支', '删除这个分支', '上移一位']) {
    expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
  }
  expect(screen.getByRole('menuitem', { name: '编辑评论' })).toBeVisible();
});
it('navigating to a distant node brings its ring into the visible window', () => {
  const tree = record([null, ...Array.from({ length: 1000 }, (_, i) => i), 0]);
  useTreeStore.setState({ tree });
  renderWithGame(<TreePanel width={240} height={150} />);
  expect(node(950)).toBeNull();
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, node: 950 })));
  expect(node(950)).toHaveAttribute('aria-current', 'step');
  expect(node(0)).toBeNull();
  expect(document.querySelectorAll('[data-tree-node]').length).toBeLessThan(30);
});

it('shows branch letters, the comment dot, the fifth main-line number and trial dashes', () => {
  const tree = record([null, 0, 1, 2, 3, 4, 0]);
  tree.nodes[1].flags = 1;
  tree.nodes[6].flags = 2;
  useTreeStore.setState({ tree });
  renderWithGame(<TreePanel width={450} height={180} />, {
    snapshot: makeSnapshot({
      tryout: 0,
      continuations: [
        { node: 1, mv: { type: 'pass' }, tryout: false },
        { node: 6, mv: { type: 'pass' }, tryout: true },
      ],
    }),
  });
  expect(screen.getByText('主分支 5 手')).toBeVisible();
  expect(node(1)).toHaveTextContent('A');
  expect(node(6)).toHaveTextContent('B');
  expect(node(1).querySelector('circle[cx="-7"]')).toBeInTheDocument();
  expect(node(6).querySelector('circle[stroke-dasharray]')).toBeInTheDocument();
  expect(node(0).querySelector('rect[fill="none"]')).toBeInTheDocument();
  expect(node(5)).toHaveTextContent('5');
  expect(node(4)).toHaveTextContent('');
});

it('a long press on a trial node opens its menu and keeps the selected line', async () => {
  const tree = record([null, 0, 1, 0]);
  tree.nodes[3].flags = 2;
  useTreeStore.setState({ tree });
  const { requests } = renderWithGame(<TreePanel width={240} height={160} />, {
    snapshot: makeSnapshot({ tryout: 0 }),
  });
  fireEvent.pointerDown(node(3), { pointerType: 'touch', pointerId: 1 });
  expect(await screen.findByRole('menuitem', { name: /结束试下.*0/ })).toBeVisible();
  fireEvent.pointerUp(node(3), { pointerType: 'touch', pointerId: 1 });
  fireEvent.click(node(3));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '保留为分支' })));
  expect(requests.filter((r) => r.type === 'gameNavigate' || r.type === 'gameEdit')).toEqual([
    { type: 'gameEdit', edit: { kind: 'tryoutKeep', node: 3 } },
  ]);
});
it('edit comment reveals the phone tab and hands focus to the acknowledged visit', async () => {
  Object.assign(window, { innerWidth: 375, innerHeight: 812 });
  const { requests } = renderWithGame(<TreePanel width={240} height={160} />, {
    answer: (r) => {
      if (r.type === 'gameNavigate')
        return { type: 'game', warnings: [], snapshot: makeSnapshot({ revision: 2, node: 3 }) };
    },
  });
  fireEvent.contextMenu(node(3));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '编辑评论' })));
  expect(requests).toContainEqual({ type: 'gameNavigate', to: { node: 3 } });
  expect(useDeviceStore.getState().settings.narrowTab).toBe('comments');
  expect(useCommentFocus.getState().visit).toBe(useGameStore.getState().nodeVisit);
});
it('a new tree revision in the same event turn prevents dispatch to an obsolete menu target', async () => {
  const { requests } = renderWithGame(<TreePanel width={240} height={160} />);
  fireEvent.contextMenu(node(3));
  const item = screen.getByRole('menuitem', { name: '设为主分支' });
  await act(async () => {
    useTreeStore.getState().apply({ ...record([null, 0]), revision: 3 });
    fireEvent.click(item);
  });
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([]);
});

it('reveals comments in the latest layout draft after delayed navigation', async () => {
  Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
  let answer!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  function LayoutState() {
    const { layout } = useLayout();
    return (
      <output>
        {panelsOf(layout.root)
          .map((p) => p.kind)
          .join(',')}
      </output>
    );
  }
  renderWithGame(
    <>
      <TreePanel width={240} height={160} />
      <LayoutState />
    </>,
    { answer: (r) => (r.type === 'gameNavigate' ? pending : undefined) },
  );
  fireEvent.contextMenu(node(3));
  fireEvent.click(screen.getByRole('menuitem', { name: '编辑评论' }));
  act(() => setLayout(presetLayout('minimal')));
  expect(screen.getByRole('status')).toHaveTextContent('header,winrate,candidates');
  await act(async () =>
    answer({ type: 'game', warnings: [], snapshot: makeSnapshot({ revision: 2, node: 3 }) }),
  );
  expect(screen.getByRole('status').textContent).toBe('header,winrate,candidates,comments');
});
it('explains why editing a kept comment is disabled during a trial', async () => {
  const { requests } = renderWithGame(<TreePanel width={240} height={160} />, {
    snapshot: makeSnapshot({ tryout: 0 }),
  });
  fireEvent.contextMenu(node(1));
  const item = screen.getByRole('menuitem', { name: '编辑评论' });
  expect(item).toHaveAttribute('aria-disabled', 'true');
  expect(item).toHaveAttribute(
    'title',
    screen.getByRole('menuitem', { name: '设为主分支' }).getAttribute('title'),
  );
  await act(async () => {
    for (const blocked of screen.getAllByRole('menuitem')) fireEvent.click(blocked);
  });
  expect(requests.filter((r) => r.type === 'gameEdit' || r.type === 'gameNavigate')).toEqual([]);
});
