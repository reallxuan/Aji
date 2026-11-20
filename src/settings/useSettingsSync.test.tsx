import { act, render, screen } from '@testing-library/react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { createFakeTransport } from '../transport/fake';
import type { UiSettings } from '../transport/generated/UiSettings';
import { TransportProvider } from '../transport/TransportProvider';
import { useSettingsStore } from './settingsStore';
import { useSettingsSync } from './useSettingsSync';

const stored: UiSettings = {
  language: 'zh-CN',
  theme: 'system',
  discLines: ['winrate', 'scoreLead'],
  visitLimit: null,
};

function Probe() {
  useSettingsSync();
  const { t } = useTranslation();
  return <p>{t('engine.state.ready')}</p>;
}

function systemPrefersDark() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-color-scheme: dark)',
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function mount() {
  const transport = createFakeTransport((request) => {
    if (request.type === 'settingsGet') return { type: 'settings', settings: stored };
    throw new Error(`unexpected ${request.type}`);
  });
  const i18n = createI18n('zh-CN');
  render(
    <I18nextProvider i18n={i18n}>
      <TransportProvider transport={transport}>
        <Probe />
      </TransportProvider>
    </I18nextProvider>,
  );
  return transport;
}

describe('useSettingsSync', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: null });
    systemPrefersDark();
  });

  it('switches the interface language when settings change', async () => {
    const transport = mount();
    expect(await screen.findByText('KataGo 已就绪。')).toBeInTheDocument();
    act(() => transport.emit({ type: 'settingsChanged', settings: { ...stored, language: 'en' } }));
    expect(await screen.findByText('KataGo is ready.')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('applies a light theme even when the system prefers dark', async () => {
    const transport = mount();
    await screen.findByText('KataGo 已就绪。');
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => transport.emit({ type: 'settingsChanged', settings: { ...stored, theme: 'light' } }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('useSettingsSync before the settings arrive', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: null });
    systemPrefersDark();
  });

  it('keeps the language the app started with', async () => {
    const transport = createFakeTransport(() => new Promise<never>(() => {}));
    const i18n = createI18n('zh-CN');
    render(
      <I18nextProvider i18n={i18n}>
        <TransportProvider transport={transport}>
          <Probe />
        </TransportProvider>
      </I18nextProvider>,
    );
    await act(async () => {});
    expect(screen.getByText('KataGo 已就绪。')).toBeInTheDocument();
  });
});
