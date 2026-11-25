import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { panelsOf } from '../layout/model';
import { currentLayout, resetLayoutDraft } from '../layout/useLayout';
import type { ConsoleLine } from '../transport/generated/ConsoleLine';
import type { Request } from '../transport/generated/Request';
import { TransportError } from '../transport/transport';
import { ConsolePanel } from './ConsolePanel';
import { resetConsoleStore } from './consoleStore';
import { openConsole, useConsoleSheet } from './openConsole';

afterEach(() => {
  resetConsoleStore();
  resetGameStore();
  resetLayoutDraft();
  useConsoleSheet.setState({ open: false, narrow: false });
});

const at = new Date(2026, 10, 25, 21, 40, 5).getTime();
const line = (seq: number, kind: ConsoleLine['kind'], text: string): ConsoleLine => ({
  seq,
  atMs: at,
  kind,
  text,
});
const LONG = `{"id":"aji-1","moveInfos":"${'x'.repeat(480)}"}`;
const LINES = [
  line(1, 'stderr', 'KataGo v1.18.2'),
  { ...line(2, 'aji', ''), note: { kind: 'started' as const, katago: '/opt/katago' } },
  line(3, 'sent', '{"id":"aji-1","maxVisits":1000000}'),
  line(4, 'received', LONG),
];

function mount(answers: Partial<Record<Request['type'], (request: Request) => unknown>> = {}) {
  const requests: Request[] = [];
  const harness = renderWithGame(<ConsolePanel />, {
    answer: (request) => {
      requests.push(request);
      const answer = answers[request.type];
      if (answer) return answer(request) as never;
      if (request.type === 'engineConsoleOpen') return { type: 'ok' };
      if (request.type === 'engineConsoleLines')
        return { type: 'engineConsoleLines', lines: LINES };
      return undefined;
    },
  });
  return { ...harness, requests };
}

const shown = () => screen.getAllByTestId('console-line').map((l) => l.textContent ?? '');

it('opens the console on mount, reads the kept lines, and closes on unmount', async () => {
  const { requests, unmount } = mount();
  await waitFor(() => expect(shown()).toHaveLength(4));
  expect(requests.slice(0, 2)).toEqual([
    { type: 'engineConsoleOpen', open: true },
    { type: 'engineConsoleLines', after: 0 },
  ]);
  expect(shown()[0]).toBe('21:40:05日志KataGo v1.18.2');
  expect(shown()[1]).toBe('21:40:05Aji启动 KataGo：/opt/katago');
  unmount();
  expect(requests.at(-1)).toEqual({ type: 'engineConsoleOpen', open: false });
});

it('filters the log and the protocol', async () => {
  mount();
  await waitFor(() => expect(shown()).toHaveLength(4));
  fireEvent.click(screen.getByRole('radio', { name: '日志' }));
  expect(shown().map((s) => s.slice(8, 11))).toEqual(['日志K', 'Aji']);
  fireEvent.click(screen.getByRole('radio', { name: '协议' }));
  expect(shown().map((s) => s.slice(8, 10))).toEqual(['发送', '接收']);
  fireEvent.click(screen.getByRole('radio', { name: '全部' }));
  expect(shown()).toHaveLength(4);
});

it('cuts a long reply at 400 characters, and 展开 shows it whole', async () => {
  mount();
  await waitFor(() => expect(shown()).toHaveLength(4));
  const reply = screen.getAllByTestId('console-line')[3];
  expect(reply).toHaveTextContent(LONG.slice(0, 400));
  expect(reply.textContent).not.toContain(LONG);
  fireEvent.click(within(reply).getByRole('button', { name: '展开' }));
  expect(reply.textContent).toContain(LONG);
});

it('sends a query on Enter, and Up recalls it', async () => {
  const { requests } = mount({
    engineConsoleSend: () => ({ type: 'engineConsoleSent', id: 'console-1' }),
  });
  const input = screen.getByRole('textbox', { name: '控制台查询' });
  fireEvent.change(input, { target: { value: '{"action":"query_version"}' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
  expect(requests.filter((r) => r.type === 'engineConsoleSend')).toEqual([
    { type: 'engineConsoleSend', query: '{"action":"query_version"}' },
  ]);
  expect(input).toHaveValue('');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input).toHaveValue('{"action":"query_version"}');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input).toHaveValue('');
});

it('an Enter that ends an input-method composition sends nothing', async () => {
  const { requests } = mount({
    engineConsoleSend: () => ({ type: 'engineConsoleSent', id: 'console-1' }),
  });
  const input = screen.getByRole('textbox', { name: '控制台查询' });
  fireEvent.change(input, { target: { value: '{"action":"query_version"}' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Enter', isComposing: true }));
  expect(requests.filter((r) => r.type === 'engineConsoleSend')).toEqual([]);
  expect(input).toHaveValue('{"action":"query_version"}');
});

it('says why a query was refused, as an Aji line', async () => {
  mount({
    engineConsoleSend: () => {
      throw new TransportError('engineConsoleRefused', 'refused', 'terminateAll');
    },
  });
  await waitFor(() => expect(shown()).toHaveLength(4));
  const input = screen.getByRole('textbox', { name: '控制台查询' });
  fireEvent.change(input, { target: { value: '{"action":"terminate_all"}' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
  expect(shown().at(-1)).toMatch(/Aji没有发送 terminate_all：它会结束 Aji 自己的分析。$/);
  expect(input).toHaveValue('{"action":"terminate_all"}');
});

it('清空 hides the lines so far', async () => {
  mount();
  await waitFor(() => expect(shown()).toHaveLength(4));
  fireEvent.click(screen.getByRole('button', { name: '清空' }));
  expect(screen.queryAllByTestId('console-line')).toEqual([]);
});

it('openConsole adds the panel to the layout once, or opens the sheet when narrow', () => {
  openConsole();
  openConsole();
  expect(panelsOf(currentLayout().root).filter((p) => p.kind === 'console')).toHaveLength(1);
  useConsoleSheet.setState({ narrow: true });
  openConsole();
  expect(useConsoleSheet.getState().open).toBe(true);
});
