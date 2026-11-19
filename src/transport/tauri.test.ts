import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
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
