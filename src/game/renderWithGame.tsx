import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { createI18n } from '../i18n/createI18n';
import type { Language } from '../i18n/language';
import { createFakeFiles, type FakeFiles, type FakeFilesOptions } from '../platform/fakeFiles';
import { PlatformProvider } from '../platform/PlatformProvider';
import { createFakeTransport, type FakeTransport } from '../transport/fake';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { OsKind } from '../transport/generated/OsKind';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { TransportProvider } from '../transport/TransportProvider';
import { useGameStore } from './gameStore';
import { makeSnapshot } from './testing';

export interface GameHarness {
  transport: FakeTransport;
  files: FakeFiles;
  requests: Request[];
}

/**
 * Renders `ui` with every provider the game header needs: a fake transport that answers game
 * requests with `next` snapshots (and `appInfo` with `os`), fake files, and `snapshot` shown.
 */
export function renderWithGame(
  ui: ReactElement,
  options: {
    snapshot?: GameSnapshot | null;
    language?: Language;
    os?: OsKind;
    files?: FakeFilesOptions;
    answer?: (request: Request) => Response | undefined;
  } = {},
) {
  const requests: Request[] = [];
  let revision = 100;
  const transport = createFakeTransport((request) => {
    requests.push(request);
    const answered = options.answer?.(request);
    if (answered) return answered;
    if (request.type === 'appInfo')
      return { type: 'appInfo', version: '0.1.0', os: options.os ?? 'macos', arch: 'aarch64' };
    return {
      type: 'game',
      snapshot: makeSnapshot({ ...(useGameStore.getState().snapshot ?? {}), revision: ++revision }),
      warnings: [],
    };
  });
  const files = createFakeFiles(options.files);
  const snapshot = options.snapshot === undefined ? makeSnapshot() : options.snapshot;
  if (snapshot) useGameStore.getState().apply(snapshot);
  const i18n = createI18n(options.language ?? 'zh-CN');
  const result = render(
    <I18nextProvider i18n={i18n}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={createEngineStore()}>
          <PlatformProvider files={files}>{ui}</PlatformProvider>
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>,
  );
  return { ...result, transport, files, requests };
}
