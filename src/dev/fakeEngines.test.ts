import { afterEach, expect, it, vi } from 'vitest';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { ConsoleLine } from '../transport/generated/ConsoleLine';
import { TransportError } from '../transport/transport';
import { scenarioTransport } from './scenarios';

afterEach(() => {
  vi.useRealTimers();
});

function analysing() {
  vi.useFakeTimers();
  const transport = scenarioTransport('analysing', { tick: 1 })!;
  const events: AppEvent[] = [];
  transport.subscribe((event) => events.push(event));
  return { transport, events };
}

async function profiles(transport: ReturnType<typeof analysing>['transport']) {
  const reply = await transport.request({ type: 'engineProfiles' });
  if (reply.type !== 'engineProfiles') throw new Error(reply.type);
  return reply;
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TransportError);
  const { code, detail } = error as TransportError;
  return { code, detail };
}

it('lists two managed profiles and switches, renames and removes them', async () => {
  const { transport, events } = analysing();
  const listed = await profiles(transport);
  expect(listed.devOverride).toBe(false);
  expect(listed.profiles.map((p) => [p.source.kind, p.current])).toEqual([
    ['managed', true],
    ['managed', false],
  ]);
  const [first, second] = listed.profiles;

  await transport.request({ type: 'engineProfileSwitch', id: second.id });
  expect((await profiles(transport)).profiles.find((p) => p.current)?.id).toBe(second.id);
  expect(events.some((e) => e.type === 'gameTrend' && e.reason === 'reset')).toBe(true);
  const status = await transport.request({ type: 'engineStatus' });
  expect(status.type === 'engineStatus' && status.running?.profile).toBe(second.name);

  expect(await refusal(transport.request({ type: 'engineProfileRemove', id: second.id }))).toEqual({
    code: 'engineProfileCurrent',
    detail: undefined,
  });
  await transport.request({ type: 'engineProfileRename', id: first.id, name: '主力' });
  await transport.request({ type: 'engineProfileRemove', id: first.id });
  expect((await profiles(transport)).profiles.map((p) => p.id)).toEqual([second.id]);
  expect(await refusal(transport.request({ type: 'engineProfileSwitch', id: 'nope' }))).toEqual({
    code: 'engineNoSuchProfile',
    detail: undefined,
  });
  expect(transport.unhandled).toEqual([]);
});

it('adds an own profile, refusing a missing network by name', async () => {
  const { transport } = analysing();
  const picked = await transport.request({ type: 'setupPickFile', purpose: 'katago' });
  expect(picked).toEqual({ type: 'setupPickFile', path: expect.stringContaining('katago') });
  const files = { katago: '/opt/homebrew/bin/katago', config: '/opt/homebrew/share/a.cfg' };
  expect(
    await refusal(
      transport.request({ type: 'engineProfileAddOwn', ...files, model: '/missing/m.bin.gz' }),
    ),
  ).toEqual({ code: 'engineOwnFile', detail: 'model:missing' });
  const added = await transport.request({
    type: 'engineProfileAddOwn',
    ...files,
    model: '/models/kata1-b28.bin.gz',
  });
  if (added.type !== 'engineProfiles') throw new Error(added.type);
  const own = added.profiles.find((p) => p.source.kind === 'own');
  expect(own).toMatchObject({ name: 'kata1-b28', current: true });
});

it('keeps stderr lines, and protocol lines only while the console is open', async () => {
  const { transport, events } = analysing();
  const lines = async () => {
    const reply = await transport.request({ type: 'engineConsoleLines', after: 0 });
    if (reply.type !== 'engineConsoleLines') throw new Error(reply.type);
    return reply.lines;
  };
  const kinds = (list: ConsoleLine[]) => new Set(list.map((l) => l.kind));
  await vi.advanceTimersByTimeAsync(500);
  expect(kinds(await lines())).toEqual(new Set(['aji', 'stderr']));

  await transport.request({ type: 'engineConsoleOpen', open: true });
  await vi.advanceTimersByTimeAsync(500);
  expect(kinds(await lines())).toEqual(new Set(['aji', 'stderr', 'sent', 'received']));
  expect(events.some((e) => e.type === 'engineConsoleLines')).toBe(true);

  await transport.request({ type: 'engineConsoleOpen', open: false });
  const before = (await lines()).length;
  await vi.advanceTimersByTimeAsync(500);
  expect((await lines()).length).toBe(before);
});

it('sends console queries with an id and refuses as the engine does', async () => {
  const { transport } = analysing();
  expect(
    await transport.request({ type: 'engineConsoleSend', query: '{"action":"query_version"}' }),
  ).toEqual({ type: 'engineConsoleSent', id: 'console-1' });
  expect(
    await transport.request({
      type: 'engineConsoleSend',
      query: '{"action":"query_version","id":"aji-3"}',
    }),
  ).toEqual({ type: 'engineConsoleSent', id: 'console-aji-3' });
  const refused = (query: string) =>
    refusal(transport.request({ type: 'engineConsoleSend', query }));
  expect(await refused('not json')).toEqual({ code: 'engineConsoleRefused', detail: 'notJson' });
  expect(await refused('{"moves":[]}')).toEqual({ code: 'engineConsoleRefused', detail: 'search' });
  expect(await refused('{"action":"terminate_all"}')).toEqual({
    code: 'engineConsoleRefused',
    detail: 'terminateAll',
  });
  expect(await refused('{"action":"terminate","terminateId":"aji-3"}')).toEqual({
    code: 'engineConsoleRefused',
    detail: 'terminateOther',
  });
});
