import { act, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { useEngineSync } from '../engine/useEngineSync';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { PlatformProvider } from '../platform/PlatformProvider';
import { createFakeTransport } from '../transport/fake';
import type { Response } from '../transport/generated/Response';
import { TransportProvider } from '../transport/TransportProvider';
import { resetGameStore, useGameStore } from './gameStore';
import { makeSnapshot } from './testing';
import { useGameSync } from './useGameSync';

afterEach(() => resetGameStore());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

it('waits for the first snapshot and the first engine status, then follows events', async () => {
  const snapshot = deferred<Response>();
  const status = deferred<Response>();
  const transport = createFakeTransport((request) =>
    request.type === 'gameSnapshot' ? snapshot.promise : status.promise,
  );
  const files = createFakeFiles();
  const engine = createEngineStore();
  let ready: boolean | null = null;
  function Probe() {
    useEngineSync();
    ready = useGameSync().ready;
    return null;
  }
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={engine}>
          <PlatformProvider files={files}>
            <Probe />
          </PlatformProvider>
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>,
  );
  expect(ready).toBe(false);
  await act(async () =>
    snapshot.resolve({
      type: 'game',
      snapshot: makeSnapshot({ revision: 1, name: 'samsung' }),
      warnings: [],
    }),
  );
  expect(ready).toBe(false);
  expect(useGameStore.getState().snapshot?.name).toBe('samsung');
  expect(files.titles.at(-1)).toBe('Aji — samsung');
  await act(async () =>
    status.resolve({
      type: 'engineStatus',
      engine: { state: 'notConfigured' },
      position: null,
      analysis: null,
      rejected: null,
      running: null,
    }),
  );
  expect(ready).toBe(true);
  act(() =>
    transport.emit({
      type: 'gameSnapshot',
      snapshot: makeSnapshot({ revision: 2, name: 'next', positionKey: '00000000000000cd' }),
    }),
  );
  expect(useGameStore.getState().snapshot?.name).toBe('next');
  expect(engine.getState().position).toBe('00000000000000cd');
  expect(files.titles.at(-1)).toBe('Aji — next');
});

it('is ready even when the snapshot request fails', async () => {
  const transport = createFakeTransport((request): Response => {
    if (request.type === 'gameSnapshot') throw new Error('no backend');
    return {
      type: 'engineStatus',
      engine: { state: 'ready', version: '1.18.2', limitReached: false },
      position: null,
      analysis: null,
      rejected: null,
      running: null,
    };
  });
  let ready = false;
  function Probe() {
    useEngineSync();
    ready = useGameSync().ready;
    return null;
  }
  await act(async () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <TransportProvider transport={transport}>
          <EngineStoreProvider store={createEngineStore()}>
            <PlatformProvider files={createFakeFiles()}>
              <Probe />
            </PlatformProvider>
          </EngineStoreProvider>
        </TransportProvider>
      </I18nextProvider>,
    );
  });
  expect(ready).toBe(true);
});
