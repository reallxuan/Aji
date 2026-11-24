import type { MenuCommand } from './files';
import { useViewStore } from '../analysis/viewStore';
import { renderWithGame } from '../game/renderWithGame';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { useDeviceStore } from '../device/deviceStore';
import { resetGameStore } from '../game/gameStore';
import { validateLayout } from '../layout/validate';
import { makeSnapshot } from '../game/testing';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { createI18n } from '../i18n/createI18n';
import { createFakeTransport } from '../transport/fake';
import type { Request } from '../transport/generated/Request';
import { TransportProvider } from '../transport/TransportProvider';
import { createFakeFiles } from './fakeFiles';
import { PlatformProvider } from './PlatformProvider';
import { usePlatformSync } from './usePlatformSync';

afterEach(() => resetGameStore());

it('tells the menu bar the language and runs menu commands', async () => {
  const requests: Request[] = [];
  const transport = createFakeTransport((request) => {
    requests.push(request);
    return { type: 'game', snapshot: makeSnapshot({ revision: 2, size: 9 }), warnings: [] };
  });
  const files = createFakeFiles();
  const i18n = createI18n('zh-CN');
  function Probe() {
    usePlatformSync();
    return null;
  }
  render(
    <I18nextProvider i18n={i18n}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={createEngineStore()}>
          <PlatformProvider files={files}>
            <Probe />
          </PlatformProvider>
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>,
  );
  expect(files.menuLanguages).toEqual(['zh-CN']);
  await act(async () => files.emitMenu({ new: 9 }));
  expect(requests).toEqual([{ type: 'gameNew', size: 9, expectedRevision: 0 }]);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(files.menuLanguages).toEqual(['zh-CN', 'en']);
});

it('applies a layout preset from the menu bar, and ignores an unknown one', async () => {
  const files = createFakeFiles();
  function Probe() {
    usePlatformSync();
    return null;
  }
  render(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <TransportProvider transport={createFakeTransport(() => ({ type: 'ok' }) as never)}>
        <EngineStoreProvider store={createEngineStore()}>
          <PlatformProvider files={files}>
            <Probe />
          </PlatformProvider>
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>,
  );
  await act(async () => files.emitMenu({ layout: 'nonsense' }));
  await act(async () => files.emitMenu({ layout: 'four' }));
  await waitFor(() =>
    expect(validateLayout(useDeviceStore.getState().settings.layout).preset).toBe('four'),
  );
});

function SyncProbe() {
  usePlatformSync();
  return <textarea aria-label="Comment" />;
}

it('quit waits for the answer and deduplicates a concurrent native quit menu event', async () => {
  const { files } = renderWithGame(<SyncProbe />, { snapshot: makeSnapshot({ changed: true }) });
  let respond!: (choice: 'discard') => void;
  const answer = new Promise<'discard'>((resolve) => (respond = resolve));
  const quit = vi.spyOn(files, 'quit');
  files.confirmDiscard = vi.fn(() => answer);
  await act(async () => {
    files.emitQuitRequested();
    files.emitMenu('quit');
  });
  expect(files.confirmDiscard).toHaveBeenCalledOnce();
  expect(quit).not.toHaveBeenCalled();
  await act(async () => respond('discard'));
  expect(quit).toHaveBeenCalledOnce();
});

it('undo from the menu goes to a focused text field first', async () => {
  const { files, requests, getByRole } = renderWithGame(<SyncProbe />, {
    snapshot: makeSnapshot({ canUndo: true, canRedo: true }),
  });
  const text = getByRole('textbox');
  const exec = vi.fn();
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
  try {
    text.focus();
    await act(async () => {
      files.emitMenu('undo');
      files.emitMenu('redo');
    });
    expect(exec.mock.calls).toEqual([['undo'], ['redo']]);
    expect(requests).toEqual([]);
    const editable = document.createElement('div');
    editable.tabIndex = 0;
    editable.setAttribute('contenteditable', 'plaintext-only');
    document.body.append(editable);
    editable.focus();
    await act(async () => files.emitMenu('undo'));
    expect(exec.mock.calls).toEqual([['undo'], ['redo'], ['undo']]);
    editable.remove();
    await act(async () => files.emitMenu('undo'));
    expect(requests).toContainEqual({ type: 'gameUndo' });
  } finally {
    Reflect.deleteProperty(document, 'execCommand');
  }
});

it.each(['cancel', 'failed write'] as const)('a %s keeps the window open', async (choice) => {
  const { files } = renderWithGame(<SyncProbe />, {
    snapshot: makeSnapshot({ changed: true }),
    files: { savePath: null },
    answer: (req) =>
      req.type === 'gameExport'
        ? {
            type: 'gameExport',
            gameRevision: 0,
            editId: 1,
            text: '(;)',
            bytes: null,
            fellBack: false,
            name: 'game.sgf',
          }
        : undefined,
  });
  files.confirmDiscard = async () => (choice === 'cancel' ? 'cancel' : 'save');
  if (choice === 'failed write')
    files.saveAs = async () => {
      throw Error('disk full');
    };
  const quit = vi.spyOn(files, 'quit');
  await act(async () => files.emitQuitRequested());
  expect(quit).not.toHaveBeenCalled();
});

it('the native file menu dispatches each export option, including an in-place save after Save As', async () => {
  const { files, requests } = renderWithGame(<SyncProbe />, {
    answer: (req) =>
      req.type === 'gameExport'
        ? {
            type: 'gameExport',
            name: 'record.sgf',
            gameRevision: 0,
            editId: 1,
            text: req.options.inPlace ? null : '(;)',
            bytes: req.options.inPlace ? 'KDstKQ==' : null,
            fellBack: false,
          }
        : undefined,
  });
  for (const command of ['saveAs', 'save', 'saveBranch', 'saveClean'] as const) {
    await act(async () => files.emitMenu(command));
  }
  expect(requests.filter((r) => r.type === 'gameExport').map((r) => r.options)).toEqual([
    { scope: 'game', clean: false, inPlace: false },
    { scope: 'game', clean: false, inPlace: true },
    { scope: 'branch', clean: false, inPlace: false },
    { scope: 'game', clean: true, inPlace: false },
  ]);
  expect(requests.filter((r) => r.type === 'gameSaved')).toHaveLength(2);
});

it('native View actions rotate the session and keep the numbered-stone settings in sync', async () => {
  const { files } = renderWithGame(<SyncProbe />);
  const choose = async (id: MenuCommand) => act(async () => files.emitMenu(id));
  await choose('rotateCw');
  expect(useViewStore.getState().orientation).toBe(1);
  await choose('flipH');
  expect(useViewStore.getState().orientation).not.toBe(1);
  await choose('resetOrientation');
  expect(useViewStore.getState().orientation).toBe(0);
  await choose('numbersLast');
  await choose('numbersRestart');
  await choose('numbersOff');
  expect(useDeviceStore.getState().settings.moveNumbers).toEqual({
    mode: 'off',
    last: 10,
    lastOn: 'last',
    restartInBranch: true,
  });
});
