import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../i18n/createI18n';
import type { Language } from '../i18n/language';
import { createFakeTransport } from '../transport/fake';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { TransportError } from '../transport/transport';
import { TransportProvider } from '../transport/TransportProvider';
import { VersionLine } from './VersionLine';

function renderWith(language: Language, handler: (request: Request) => Response) {
  return render(
    <I18nextProvider i18n={createI18n(language)}>
      <TransportProvider transport={createFakeTransport(handler)}>
        <VersionLine />
      </TransportProvider>
    </I18nextProvider>,
  );
}

it('shows the version line in English', async () => {
  renderWith('en', () => ({ type: 'appInfo', version: '0.1.0', os: 'macos', arch: 'aarch64' }));
  expect(await screen.findByText('Aji version 0.1.0 (macOS aarch64)')).toBeInTheDocument();
});

it('translates an unknown OS in Chinese', async () => {
  renderWith('zh-CN', () => ({ type: 'appInfo', version: '0.1.0', os: 'other', arch: 'riscv64' }));
  expect(await screen.findByText('Aji 版本 0.1.0（未知系统 riscv64）')).toBeInTheDocument();
});

it('shows localised error text, not the raw message', async () => {
  renderWith('zh-CN', () => {
    throw new TransportError('internal', 'raw backend text');
  });
  expect(await screen.findByText('Aji 内部出错。')).toBeInTheDocument();
  expect(screen.queryByText(/raw backend text/)).toBeNull();
});
