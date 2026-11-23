import { act, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
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
  await act(async () => files.emitMenu('new9'));
  expect(requests).toEqual([{ type: 'gameNew', size: 9 }]);
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
