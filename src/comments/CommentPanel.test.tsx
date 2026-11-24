import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useKeyDispatcher } from '../commands/useKeyDispatcher';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { useTreeStore } from '../game/treeStore';
import { panelSpec } from '../layout/registry';
import type { Response } from '../transport/generated/Response';
import { TreePanel } from '../tree/TreePanel';
import { record } from '../tree/testing';
import { flushCommentEdits } from './commentWrites';
import { useCommentFocus } from './commentFocus';

const Panel = panelSpec('comments').Component;
const panel = <Panel panel={{ kind: 'comments' }} width={320} height={180} />;
const field = () => screen.getByRole('textbox');
const type = (value: string) => {
  act(() => field().focus());
  fireEvent.change(field(), { target: { value } });
};
const change = (node: number, text: string | null) => ({
  type: 'gameEdit',
  edit: { kind: 'setComment', node, text },
});
beforeEach(() => {
  resetGameStore();
  useCommentFocus.setState({ visit: null });
  useTreeStore.setState({ tree: record([null, 0, 1, 0]) });
});

it('blur keeps the comment, and clearing the field removes C', async () => {
  const { requests } = renderWithGame(panel, {
    snapshot: makeSnapshot({ comment: 'old' }),
    answer: (r) => {
      if (r.type === 'gameEdit' && r.edit.kind === 'setComment')
        return {
          type: 'game',
          warnings: [],
          snapshot: makeSnapshot({
            revision: useGameStore.getState().snapshot!.revision + 1,
            comment: r.edit.text,
          }),
        };
    },
  });
  expect(screen.getByText('开局前')).toBeVisible();
  type('two\nlines');
  await act(async () => field().blur());
  type('');
  await act(async () => fireEvent.keyDown(field(), { key: 'Escape' }));
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([
    change(0, 'two\nlines'),
    change(0, null),
  ]);
  expect(field()).toHaveAttribute('placeholder', '添加评论');
});

it('navigating while typing keeps it on the old node', async () => {
  const { requests } = renderWithGame(panel);
  type('first');
  await act(async () =>
    useGameStore.getState().apply(makeSnapshot({ revision: 2, node: 2, comment: 'second' })),
  );
  expect(requests).toContainEqual(change(0, 'first'));
  expect(field()).toHaveValue('second');
});

it('never writes a draft to a replacement game with a recycled node id', async () => {
  const { requests } = renderWithGame(panel);
  type('old game');
  await act(async () =>
    useGameStore
      .getState()
      .apply(makeSnapshot({ revision: 2, gameRevision: 2, comment: 'replacement' })),
  );
  expect(requests).not.toContainEqual(change(0, 'old game'));
  expect(field()).toHaveValue('replacement');
});

it('updates untouched text, preserves typing through snapshot events, and keeps it on unmount', async () => {
  const { requests, unmount } = renderWithGame(panel);
  act(() => field().focus());
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, comment: 'remote' })));
  expect(field()).toHaveValue('remote');
  type('local');
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 3, comment: 'remote' })));
  expect(field()).toHaveValue('local');
  await act(async () => unmount());
  expect(requests).toContainEqual(change(0, 'local'));
});

it('keeps a newer draft when the previous blur is acknowledged', async () => {
  let finish!: (r: Response) => void;
  const pending = new Promise<Response>((r) => {
    finish = r;
  });
  const { requests } = renderWithGame(panel, {
    answer: (r) => (r.type === 'gameEdit' ? pending : undefined),
  });
  type('first');
  act(() => field().blur());
  expect(field()).toHaveValue('first');
  type('second');
  await act(async () =>
    finish({
      type: 'game',
      warnings: [],
      snapshot: makeSnapshot({ revision: 2, comment: 'first' }),
    }),
  );
  expect(field()).toHaveValue('second');
  await act(async () => field().blur());
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([
    change(0, 'first'),
    change(0, 'second'),
  ]);
});

it('typing_in_the_comment_never_reaches_the_board', async () => {
  function WithKeys() {
    useKeyDispatcher(true);
    return panel;
  }
  const { requests } = renderWithGame(<WithKeys />);
  act(() => field().focus());
  for (const key of [
    'v',
    'b',
    '[',
    ']',
    'n',
    'Delete',
    'Backspace',
    'ArrowLeft',
    'ArrowRight',
    ' ',
    'z',
  ]) {
    expect(fireEvent.keyDown(field(), { key, metaKey: key === 'z' })).toBe(true);
  }
  await act(async () => fireEvent.keyDown(field(), { key: 'Escape' }));
  expect(field()).not.toHaveFocus();
  expect(requests.filter((r) => r.type !== 'appInfo')).toEqual([]);
});

it('edit comment from the node menu focuses the field', async () => {
  renderWithGame(
    <>
      <TreePanel width={240} height={160} />
      {panel}
    </>,
    {
      answer: (r) =>
        r.type === 'gameNavigate'
          ? { type: 'game', warnings: [], snapshot: makeSnapshot({ revision: 2, node: 3 }) }
          : undefined,
    },
  );
  fireEvent.contextMenu(document.querySelector('[data-tree-node="3"]')!);
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '编辑评论' })));
  await waitFor(() => expect(field()).toHaveFocus());
  expect(useCommentFocus.getState().visit).toBeNull();
});

it('identifies the played colour and coordinate even with a player override', () => {
  const tree = record([null, 0]);
  tree.nodes[1].color = 'white';
  useTreeStore.setState({ tree });
  renderWithGame(panel, {
    snapshot: makeSnapshot({
      node: 1,
      atStart: false,
      lastMove: { type: 'play', x: 12, y: 2 },
      moveNumber: 38,
      nextColor: 'white',
    }),
  });
  expect(screen.getByText('第 38 手 白 N17')).toBeVisible();
});

it('allows comments only on scratch nodes during try-out', async () => {
  const tree = record([null, 0, 1, 0]);
  tree.nodes[3].flags = 2;
  useTreeStore.setState({ tree });
  const { requests } = renderWithGame(panel, { snapshot: makeSnapshot({ tryout: 0 }) });
  expect(field()).toBeDisabled();
  expect(field()).toHaveAttribute('title', '先结束试下');
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, node: 3, tryout: 0 })));
  expect(field()).toBeEnabled();
  type('trial');
  await act(async () => field().blur());
  expect(requests).toContainEqual(change(3, 'trial'));
});

it('shows a newer remote comment after a superseded save reply', async () => {
  let finish!: (r: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const { requests, unmount } = renderWithGame(panel, {
    answer: (r) => (r.type === 'gameEdit' ? pending : undefined),
  });
  type('local');
  act(() => field().blur());
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, comment: 'local' })));
  act(() => useGameStore.getState().apply(makeSnapshot({ revision: 3, comment: 'remote' })));
  await act(async () =>
    finish({
      type: 'game',
      warnings: [],
      snapshot: makeSnapshot({ revision: 2, comment: 'local' }),
    }),
  );
  expect(field()).toHaveValue('remote');
  unmount();
  expect(requests.filter((r) => r.type === 'gameEdit')).toHaveLength(1);
});

it('leaves a failed save available to retry by focusing and leaving again', async () => {
  let attempt = 0;
  const { requests } = renderWithGame(panel, {
    answer: (r) => {
      if (r.type !== 'gameEdit') return;
      if (!attempt++) return Promise.reject(new Error('Disconnected'));
      return {
        type: 'game',
        warnings: [],
        snapshot: makeSnapshot({ revision: 2, comment: 'retry me' }),
      };
    },
  });
  type('retry me');
  await act(async () => field().blur());
  expect(field()).toHaveValue('retry me');
  act(() => field().focus());
  await act(async () => field().blur());
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([
    change(0, 'retry me'),
    change(0, 'retry me'),
  ]);
  expect(useGameStore.getState().snapshot?.comment).toBe('retry me');
});

it.each(['blur', 'navigation', 'unmount'])(
  'keeps verified scratch text on %s while the tree lags',
  async (leave) => {
    const tree = record([null, 0]);
    tree.nodes[1].flags = 2;
    useTreeStore.setState({ tree });
    const { requests, unmount } = renderWithGame(panel, {
      snapshot: makeSnapshot({ tryout: 0, node: 1 }),
    });
    type('scratch draft');
    act(() =>
      useGameStore.getState().apply(
        makeSnapshot({
          tryout: 0,
          node: leave === 'navigation' ? 0 : 1,
          revision: 2,
          treeRevision: 1,
        }),
      ),
    );
    await act(async () => {
      if (leave === 'unmount') unmount();
      else if (leave === 'blur') fireEvent.blur(field());
    });
    expect(requests).toContainEqual(change(1, 'scratch draft'));
  },
);

function delayed() {
  let resolve!: (r: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
const answerGame = (
  revision: number,
  node: number,
  comment: string | null,
  treeRevision = 0,
): Response => ({
  type: 'game',
  warnings: [],
  snapshot: makeSnapshot({ revision, node, comment, treeRevision }),
});

it.each(['same visit', 'remount', 'replacement'])(
  'serializes two finished edits to the same node (%s)',
  async (scenario) => {
    const first = delayed();
    const { requests } = renderWithGame(panel, {
      answer: (r) => {
        if (r.type !== 'gameEdit' || r.edit.kind !== 'setComment') return;
        return r.edit.text === 'one' ? first.promise : answerGame(10, 0, r.edit.text);
      },
    });
    type('one');
    act(() => field().blur());
    if (scenario === 'remount') {
      act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, node: 3 })));
      act(() => useGameStore.getState().apply(makeSnapshot({ revision: 3, node: 0 })));
      expect(field()).toHaveValue('one');
    }
    type('two');
    act(() => field().blur());
    expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([change(0, 'one')]);
    if (scenario === 'replacement')
      act(() =>
        useGameStore
          .getState()
          .apply(makeSnapshot({ revision: 9, gameRevision: 1, comment: 'new game' })),
      );
    await act(async () => first.resolve(answerGame(4, 0, 'one')));
    if (scenario === 'replacement') {
      expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([change(0, 'one')]);
      expect(field()).toHaveValue('new game');
    } else {
      expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([
        change(0, 'one'),
        change(0, 'two'),
      ]);
      expect(field()).toHaveValue('two');
    }
  },
);

it.each(['comment dot', 'later visit'])(
  'delivers menu focus only to the acknowledged visit (%s)',
  async (scenario) => {
    const nav = delayed();
    renderWithGame(
      <>
        <TreePanel width={240} height={160} />
        {panel}
      </>,
      { answer: (r) => (r.type === 'gameNavigate' ? nav.promise : undefined) },
    );
    fireEvent.contextMenu(document.querySelector('[data-tree-node="3"]')!);
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑评论' }));
    act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, node: 3 })));
    if (scenario === 'comment dot') {
      act(() =>
        useGameStore.getState().apply(makeSnapshot({ revision: 3, node: 3, treeRevision: 1 })),
      );
    } else {
      act(() => useGameStore.getState().apply(makeSnapshot({ revision: 3, node: 1 })));
      act(() => useGameStore.getState().apply(makeSnapshot({ revision: 4, node: 3 })));
    }
    await act(async () => nav.resolve(answerGame(2, 3, null)));
    if (scenario === 'comment dot') expect(field()).toHaveFocus();
    else expect(field()).not.toHaveFocus();
  },
);

it('drains a focused field including typing resumed during the native action', async () => {
  const first = delayed(),
    second = delayed();
  const { transport, requests } = renderWithGame(panel, {
    answer: (r) =>
      r.type === 'gameEdit' && r.edit.kind === 'setComment'
        ? (r.edit.text === 'one' ? first : second).promise
        : undefined,
  });
  type('one');
  let decision!: Promise<boolean>;
  act(() => {
    decision = flushCommentEdits(transport);
  });
  type('two');
  await act(async () => first.resolve(answerGame(2, 0, 'one')));
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([
    change(0, 'one'),
    change(0, 'two'),
  ]);
  expect(field()).not.toHaveFocus();
  await act(async () => second.resolve(answerGame(3, 0, 'two')));
  expect(await decision).toBe(true);
  expect(useGameStore.getState().snapshot?.comment).toBe('two');
});

it('reports a failed comment flush to the pending native action', async () => {
  const { transport } = renderWithGame(panel, {
    answer: (r) => (r.type === 'gameEdit' ? Promise.reject(new Error('offline')) : undefined),
  });
  type('retry');
  await act(async () => expect(await flushCommentEdits(transport)).toBe(false));
  expect(field()).toHaveValue('retry');
});

it.each(['retry on return', 'retry before save', 'explicit discard', 'replacement'])(
  'retains a refused draft after navigation (%s)',
  async (scenario) => {
    const first = delayed();
    let online = false;
    const { transport, requests } = renderWithGame(panel, {
      answer: (r) => {
        if (r.type !== 'gameEdit' || r.edit.kind !== 'setComment') return;
        const attempts = requests.filter((m) => m.type === 'gameEdit').length;
        if (attempts === 1) return first.promise;
        if (!online) return Promise.reject(new Error('offline'));
        return answerGame(
          6,
          useGameStore.getState().snapshot!.node,
          useGameStore.getState().snapshot!.node === 0 ? r.edit.text : null,
        );
      },
    });
    type('recover me');
    act(() => useGameStore.getState().apply(makeSnapshot({ revision: 2, node: 3 })));
    await act(async () => first.reject(new Error('offline')));
    if (scenario === 'replacement') {
      act(() =>
        useGameStore
          .getState()
          .apply(makeSnapshot({ revision: 3, gameRevision: 1, comment: 'new game' })),
      );
      await act(async () => expect(await flushCommentEdits(transport)).toBe(true));
      expect(field()).toHaveValue('new game');
      expect(requests.filter((r) => r.type === 'gameEdit')).toHaveLength(1);
      return;
    }
    await act(async () => expect(await flushCommentEdits(transport)).toBe(false));
    expect(requests.filter((r) => r.type === 'gameEdit')).toHaveLength(2);
    if (scenario === 'explicit discard') {
      const { discardFailedCommentEdits } = await import('./commentWrites');
      act(() => discardFailedCommentEdits(transport, 0));
      await act(async () => expect(await flushCommentEdits(transport)).toBe(true));
      act(() => useGameStore.getState().apply(makeSnapshot({ revision: 3, node: 0 })));
      expect(field()).toHaveValue('');
      expect(requests.filter((r) => r.type === 'gameEdit')).toHaveLength(2);
      return;
    }
    online = true;
    if (scenario === 'retry on return') {
      act(() => useGameStore.getState().apply(makeSnapshot({ revision: 3, node: 0 })));
      expect(field()).toHaveValue('recover me');
      act(() => field().focus());
      await act(async () => field().blur());
      expect(useGameStore.getState().snapshot?.comment).toBe('recover me');
    } else await act(async () => expect(await flushCommentEdits(transport)).toBe(true));
    expect(requests.filter((r) => r.type === 'gameEdit')).toEqual(
      Array(3).fill(change(0, 'recover me')),
    );
  },
);

it('keeps the verified scratch editor focused while the matching tree is in flight', async () => {
  const tree = record([null, 0]);
  tree.nodes[1].flags = 2;
  useTreeStore.setState({ tree });
  const { requests } = renderWithGame(panel, { snapshot: makeSnapshot({ tryout: 0, node: 1 }) });
  type('in progress');
  act(() =>
    useGameStore
      .getState()
      .apply(makeSnapshot({ revision: 2, node: 1, tryout: 0, treeRevision: 1 })),
  );
  expect(field()).toBeEnabled();
  expect(field()).toHaveFocus();
  type('finished');
  await act(async () => field().blur());
  expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([change(1, 'finished')]);
});

it.each(['ended trial', 'deleted kept node', 'ended trial then undo'])(
  'drops a failed comment after the tree confirms its target is gone (%s)',
  async (operation) => {
    const tree = record([null, 0]);
    const trying = operation !== 'deleted kept node';
    if (trying) tree.nodes[1].flags = 2;
    useTreeStore.setState({ tree });
    const { transport, requests } = renderWithGame(panel, {
      snapshot: makeSnapshot({ node: 1, tryout: trying ? 0 : null }),
      answer: (r) => (r.type === 'gameEdit' ? Promise.reject(new Error('offline')) : undefined),
    });
    type('draft');
    await act(async () => field().blur());
    act(() =>
      useGameStore
        .getState()
        .apply(makeSnapshot({ revision: 2, treeRevision: 1, node: 0, changed: true })),
    );
    act(() => useTreeStore.getState().apply({ ...record([null]), revision: 1 }));
    if (operation === 'ended trial then undo') {
      act(() =>
        useGameStore
          .getState()
          .apply(makeSnapshot({ revision: 3, treeRevision: 2, node: 1, tryout: 0 })),
      );
      act(() => useTreeStore.getState().apply({ ...tree, revision: 2 }));
      expect(field()).toHaveValue('');
    }
    await act(async () => expect(await flushCommentEdits(transport)).toBe(true));
    expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([change(1, 'draft')]);
  },
);

it.each(['missing', 'stale', 'kept'])(
  'preserves a failed scratch comment unless a matching tree proves removal (%s)',
  async (state) => {
    const tree = record([null, 0]);
    tree.nodes[1].flags = 2;
    useTreeStore.setState({ tree });
    let online = false;
    const { transport, requests } = renderWithGame(panel, {
      snapshot: makeSnapshot({ node: 1, tryout: 0 }),
      answer: (r) =>
        r.type === 'gameEdit'
          ? online
            ? answerGame(4, 0, null, 2)
            : Promise.reject(new Error('offline'))
          : undefined,
    });
    type('survives');
    await act(async () => field().blur());
    act(() =>
      useGameStore.getState().apply(makeSnapshot({ revision: 3, node: 0, treeRevision: 2 })),
    );
    const kept = record([null, 0]);
    act(() =>
      useTreeStore.setState({
        tree:
          state === 'missing'
            ? null
            : state === 'stale'
              ? { ...record([null]), revision: 1 }
              : { ...kept, revision: 2 },
      }),
    );
    online = true;
    await act(async () => expect(await flushCommentEdits(transport)).toBe(true));
    expect(requests.filter((r) => r.type === 'gameEdit')).toEqual([
      change(1, 'survives'),
      change(1, 'survives'),
    ]);
  },
);
