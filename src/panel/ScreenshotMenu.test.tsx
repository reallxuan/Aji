import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoticeStore } from '../game/noticeStore';
import { renderWithGame } from '../game/renderWithGame';
import { createFakeFiles } from '../platform/fakeFiles';
import { usePlatformSync } from '../platform/usePlatformSync';
import { copyImage } from '../platform/clipboard';
import { GameMenu } from './GameMenu';
import { PanelHeader } from './PanelHeader';
import { copyShot, saveShot } from './ScreenshotMenu';

vi.mock('../board/snapshotImage', () => ({
  boardImage: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  useNoticeStore.setState({ notice: null });
});

/** A board host, as `MainBoard` renders one. */
function board() {
  const area = document.createElement('div');
  area.setAttribute('data-board', '');
  area.append(document.createElement('div'));
  document.body.append(area);
  return area;
}

describe('screenshots', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('save_cancelled_returns_false', async () => {
    board();
    const cancelled = createFakeFiles({ savePath: null });
    expect(await saveShot('board', cancelled, '未命名棋局', (k) => k)).toBe(false);
    const saving = createFakeFiles();
    expect(await saveShot('board', saving, '未命名棋局', (k) => k)).toBe(true);
    expect(saving.images.get('/fake/未命名棋局 screenshot.targets.board.png')).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('copy_falls_back_with_a_message', async () => {
    board();
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    expect(await copyImage(Promise.resolve(new Uint8Array([1])))).toBe(false);
    await copyShot('board', createFakeFiles(), (k) => k);
    expect(useNoticeStore.getState().notice).toMatchObject({
      kind: 'warning',
      title: 'screenshot.copyFailed',
    });
  });

  it('copies through the clipboard as a PNG', async () => {
    board();
    const write = vi.fn(async () => {});
    class Item {
      constructor(public items: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', Item);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write } });
    await copyShot('board', createFakeFiles(), (k) => k);
    const [[items]] = write.mock.calls as unknown as Array<[Item[]]>;
    const blob = await items[0].items['image/png'];
    expect(blob.type).toBe('image/png');
    expect(useNoticeStore.getState().notice).toBeNull();
  });

  it('the desktop copies through the app, which a menu-bar click can reach', async () => {
    board();
    const files = createFakeFiles();
    let copied: Uint8Array | null = null;
    files.copyImage = async (bytes) => {
      copied = await bytes;
      return true;
    };
    expect(await copyShot('board', files, (k) => k)).toBe(true);
    expect(copied).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('the Mac menu bar saves and copies, and says when the target is not on screen', async () => {
    board();
    const { files } = renderWithGame(<Sync />);
    await act(async () => files.emitMenu({ saveImage: 'board' }));
    await waitFor(() => expect(files.images.size).toBe(1));
    await act(async () => files.emitMenu({ copyImage: 'graph' }));
    expect(useNoticeStore.getState().notice).toMatchObject({
      kind: 'warning',
      title: '走势图不在屏幕上',
    });
  });

  it('the 视图 menu offers 截图 for what is on screen', async () => {
    board();
    renderWithGame(<PanelHeader />, { os: 'windows' });
    await act(async () => {});
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: '视图' }), { key: 'Enter' });
    });
    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: '截图' });
    await act(async () => {
      item.focus();
      fireEvent.keyDown(item, { key: 'ArrowRight' });
    });
    const sub = screen.getAllByRole('menu').at(-1) as HTMLElement;
    expect(within(sub).getByRole('menuitem', { name: '保存棋盘…' })).not.toHaveAttribute(
      'data-disabled',
    );
    // No sub-board and no graph on screen.
    expect(within(sub).getByRole('menuitem', { name: '复制副盘' })).toHaveAttribute(
      'data-disabled',
    );
    expect(within(sub).getByRole('menuitem', { name: '保存走势图…' })).toHaveAttribute(
      'data-disabled',
    );
  });
});

/** The app's platform hook, which applies the setting and hears the macOS menu. */
function Sync() {
  usePlatformSync();
  return null;
}

describe('always on top', () => {
  it('always_on_top_is_remembered_per_device_and_applied_at_start', async () => {
    const { useDeviceStore } = await import('../device/deviceStore');
    // The device store as it stands once loaded at start.
    useDeviceStore.getState().update({ alwaysOnTop: true });
    useDeviceStore.setState({ loaded: true });
    const { files } = renderWithGame(
      <>
        <Sync />
        <GameMenu />
      </>,
    );
    await waitFor(() => expect(files.alwaysOnTop).toEqual([true]));
    act(() => useDeviceStore.getState().update({ alwaysOnTop: false }));
    await waitFor(() => expect(files.alwaysOnTop).toEqual([true, false]));
    // It lives in settings only: the game menu no longer offers it (owner, 2026-11-22).
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: '未命名棋局' }), { key: 'Enter' });
    });
    expect(screen.queryByRole('menuitemcheckbox', { name: '总在最前' })).toBeNull();
  });
});
