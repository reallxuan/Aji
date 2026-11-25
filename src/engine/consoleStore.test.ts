import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { createFakeTransport } from '../transport/fake';
import { TransportProvider } from '../transport/TransportProvider';
import type { ConsoleLine } from '../transport/generated/ConsoleLine';
import { CONSOLE_KEPT, resetConsoleStore, useConsoleStore, useConsoleSync } from './consoleStore';

afterEach(resetConsoleStore);

const line = (seq: number, text = `line ${seq}`): ConsoleLine => ({
  seq,
  atMs: 1_700_000_000_000 + seq,
  kind: 'stderr',
  text,
});

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => line(from + i));

const received = (seq: number): ConsoleLine => ({ ...line(seq), kind: 'received' });

it('keeps the newest 1,000 log lines and the newest 5,000 protocol lines, as the backend does', () => {
  expect(CONSOLE_KEPT).toEqual({ log: 1000, protocol: 5000 });
  useConsoleStore.getState().append(range(1, 1500));
  useConsoleStore.getState().append(Array.from({ length: 6000 }, (_, i) => received(1501 + i)));
  const { lines } = useConsoleStore.getState();
  const log = lines.filter((l) => l.kind === 'stderr');
  const protocol = lines.filter((l) => l.kind === 'received');
  expect(log.map((l) => l.seq)).toEqual(range(501, 1500).map((l) => l.seq));
  expect(protocol).toHaveLength(5000);
  expect(protocol[0].seq).toBe(2501);
  expect(lines.at(-1)?.seq).toBe(7500);
});

it('a flood of protocol lines leaves KataGo’s start-up lines in the log', () => {
  useConsoleStore.getState().append(range(1, 5));
  for (let batch = 0; batch < 12; batch++)
    useConsoleStore
      .getState()
      .append(Array.from({ length: 1000 }, (_, i) => received(6 + batch * 1000 + i)));
  const log = useConsoleStore.getState().lines.filter((l) => l.kind === 'stderr');
  expect(log.map((l) => l.seq)).toEqual([1, 2, 3, 4, 5]);
});

it('drops lines it already has, so a reload after an event adds nothing twice', () => {
  useConsoleStore.getState().append(range(1, 3));
  useConsoleStore.getState().append(range(2, 5));
  expect(useConsoleStore.getState().lines.map((l) => l.seq)).toEqual([1, 2, 3, 4, 5]);
});

it('takes older lines a reload brings that no event carried, in order', () => {
  // KataGo's start-up lines come before the interface subscribes; an event then carries line 6.
  useConsoleStore.getState().append(range(6, 7));
  useConsoleStore.getState().append(range(1, 7));
  expect(useConsoleStore.getState().lines.map((l) => l.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

it('clear hides what has arrived, and later lines still show', () => {
  useConsoleStore.getState().append(range(1, 3));
  useConsoleStore.getState().clear();
  expect(useConsoleStore.getState().lines).toEqual([]);
  expect(useConsoleStore.getState().after).toBe(3);
  // A reload of the kept lines brings back nothing that was cleared.
  useConsoleStore.getState().append(range(1, 4));
  expect(useConsoleStore.getState().lines.map((l) => l.seq)).toEqual([4]);
});

it('remembers sent queries for recall, newest last, without repeating the last one', () => {
  const { remember } = useConsoleStore.getState();
  remember('{"action":"query_version"}');
  remember('{"action":"query_models"}');
  remember('{"action":"query_models"}');
  expect(useConsoleStore.getState().history).toEqual([
    '{"action":"query_version"}',
    '{"action":"query_models"}',
  ]);
});

it('sets the filter and pauses scrolling', () => {
  useConsoleStore.getState().setFilter('protocol');
  useConsoleStore.getState().setPaused(true);
  expect(useConsoleStore.getState()).toMatchObject({ filter: 'protocol', paused: true });
});

it('appends the lines an engineConsoleLines event carries', () => {
  const transport = createFakeTransport(() => ({ type: 'ok' }));
  renderHook(() => useConsoleSync(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(TransportProvider, { transport, children }),
  });
  act(() => transport.emit({ type: 'engineConsoleLines', lines: [line(7, 'hello')] }));
  expect(useConsoleStore.getState().lines.map((l) => l.text)).toEqual(['hello']);
});
