import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { resetNotices, useNoticeStore } from '../game/noticeStore';
import { renderWithGame } from '../game/renderWithGame';
import { DropOverlay } from './DropOverlay';

afterEach(() => {
  resetGameStore();
  resetNotices();
});

it('shows while a file is over the window, with its name when known', () => {
  const { files } = renderWithGame(<DropOverlay />);
  expect(screen.queryByText('松开以打开棋谱')).toBeNull();
  act(() => files.emitDrag({ kind: 'over', paths: ['/下载/Samsung 30 final 2.sgf'] }));
  expect(screen.getByText('松开以打开棋谱')).toBeInTheDocument();
  expect(screen.getByText('Samsung 30 final 2.sgf')).toBeInTheDocument();
  // Later moves over the window carry no paths; the name stays.
  act(() => files.emitDrag({ kind: 'over' }));
  expect(screen.getByText('Samsung 30 final 2.sgf')).toBeInTheDocument();
  act(() => files.emitDrag({ kind: 'leave' }));
  expect(screen.queryByText('松开以打开棋谱')).toBeNull();
});

it('opens a dropped record and hides', async () => {
  const { files, requests } = renderWithGame(<DropOverlay />, {
    language: 'en',
    files: { files: { '/g/a.sgf': '(;GM[1])' } },
  });
  act(() => files.emitDrag({ kind: 'over' }));
  expect(screen.getByText('Release to open the record')).toBeInTheDocument();
  act(() => files.emitDrag({ kind: 'drop', paths: ['/g/a.sgf'] }));
  expect(screen.queryByText('Release to open the record')).toBeNull();
  await waitFor(() => expect(requests.some((r) => r.type === 'gameOpen')).toBe(true));
});

it('answers a dropped file that is not a record with the error line', () => {
  const { files } = renderWithGame(<DropOverlay />);
  act(() => files.emitDrag({ kind: 'drop', paths: ['/photos/board.png'] }));
  expect(useNoticeStore.getState().notice).toMatchObject({
    kind: 'error',
    title: '无法打开 board.png',
  });
});
