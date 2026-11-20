import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App';
import { createEngineStore, EngineStoreProvider } from './engine/engineStore';
import { createI18n } from './i18n/createI18n';
import { resolveLanguage } from './i18n/language';
import './styles/index.css';
import { applyTheme, readSystemTheme, resolveTheme } from './theme/theme';
import { createTauriTransport } from './transport/tauri';
import type { Transport } from './transport/transport';
import { TransportProvider } from './transport/TransportProvider';

// Set the theme before the first render so the first frame already has the right ground colour.
applyTheme(resolveTheme('system', readSystemTheme(window.matchMedia?.bind(window))));

/**
 * The Tauri transport, or in a development build with `?scenario=<name>`, a scripted one
 * (docs/development.md). `import.meta.env.DEV` is false in a production build, so the scenarios
 * module and this branch are left out of it.
 */
async function chooseTransport(): Promise<Transport> {
  if (import.meta.env.DEV) {
    const name = new URLSearchParams(window.location.search).get('scenario');
    if (name) {
      const { scenarioTransport, SCENARIOS } = await import('./dev/scenarios');
      const transport = scenarioTransport(name);
      if (transport) return transport;
      console.warn(`Unknown scenario "${name}". Known: ${SCENARIOS.join(', ')}`);
    }
  }
  return createTauriTransport();
}

async function start() {
  const transport = await chooseTransport();
  const engineStore = createEngineStore();
  const i18n = createI18n(resolveLanguage('system', navigator.languages));

  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <TransportProvider transport={transport}>
          <EngineStoreProvider store={engineStore}>
            <App />
          </EngineStoreProvider>
        </TransportProvider>
      </I18nextProvider>
    </StrictMode>,
  );
}

void start();
