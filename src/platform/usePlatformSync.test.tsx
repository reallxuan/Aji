import { act, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { resetGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
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
        <PlatformProvider files={files}>
          <Probe />
        </PlatformProvider>
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
