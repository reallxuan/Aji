import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import type { AppEvent } from './generated/AppEvent';
import { createTauriTransport } from './tauri';

afterEach(() => clearMocks());

it('sends every request through the rpc command', async () => {
  const calls: unknown[] = [];
  mockIPC((cmd, args) => {
    calls.push([cmd, args]);
    return { type: 'appInfo', version: '0.1.0', os: 'macos', arch: 'aarch64' };
  });
  await expect(createTauriTransport().request({ type: 'appInfo' })).resolves.toEqual({
    type: 'appInfo',
    version: '0.1.0',
    os: 'macos',
    arch: 'aarch64',
  });
  expect(calls).toEqual([['rpc', { request: { type: 'appInfo' } }]]);
});

it('rejects with a TransportError when the command fails', async () => {
  mockIPC(() => {
    throw { code: 'internal', message: 'boom' };
  });
  await expect(createTauriTransport().request({ type: 'appInfo' })).rejects.toMatchObject({
    code: 'internal',
  });
});

describe('subscribe', () => {
  const payload: AppEvent = { type: 'engineState', engine: { state: 'starting' } };

  it('delivers events emitted on aji://event', async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const received: AppEvent[] = [];
    const unsubscribe = createTauriTransport().subscribe((event) => received.push(event));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await emit('aji://event', payload);
    expect(received).toEqual([payload]);
    unsubscribe();
  });

  it('delivers nothing after an unsubscribe that ran before listen resolved', async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const received: AppEvent[] = [];
    const unsubscribe = createTauriTransport().subscribe((event) => received.push(event));
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await emit('aji://event', payload);
    expect(received).toEqual([]);
  });
});
