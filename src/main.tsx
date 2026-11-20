import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App';
import { createEngineStore, EngineStoreProvider } from './engine/engineStore';
import { createI18n } from './i18n/createI18n';
import { resolveLanguage } from './i18n/language';
import type { PlatformFiles } from './platform/files';
import { PlatformProvider } from './platform/PlatformProvider';
import { createTauriFiles } from './platform/tauriFiles';
import './styles/index.css';
import { applyTheme, readSystemTheme, resolveTheme } from './theme/theme';
import { createTauriTransport } from './transport/tauri';
import type { Transport } from './transport/transport';
import { TransportProvider } from './transport/TransportProvider';

// Set the theme before the first render so the first frame already has the right ground colour.
applyTheme(resolveTheme('system', readSystemTheme(window.matchMedia?.bind(window))));

/**
 * The Tauri transport and files, or in a development build with `?scenario=<name>`, scripted ones
 * (docs/development.md). `import.meta.env.DEV` is false in a production build, so the scenarios
 * module and this branch are left out of it.
 */
async function chooseBackend(): Promise<{ transport: Transport; files: PlatformFiles }> {
  if (import.meta.env.DEV) {
    const name = new URLSearchParams(window.location.search).get('scenario');
    if (name) {
      const { scenarioTransport, SCENARIOS } = await import('./dev/scenarios');
      const { SAMPLE_FILES } = await import('./dev/fakeGame');
      const { createFakeFiles } = await import('./platform/fakeFiles');
      const { forwardBrowserDrops } = await import('./dev/browserDrops');
      const transport = scenarioTransport(name);
      if (transport) {
        const files = createFakeFiles(SAMPLE_FILES);
        forwardBrowserDrops(files);
        return { transport, files };
      }
      console.warn(`Unknown scenario "${name}". Known: ${SCENARIOS.join(', ')}`);
    }
  }
  return { transport: createTauriTransport(), files: createTauriFiles() };
}

async function start() {
  const { transport, files } = await chooseBackend();
  const engineStore = createEngineStore();
  const i18n = createI18n(resolveLanguage('system', navigator.languages));

  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <TransportProvider transport={transport}>
          <EngineStoreProvider store={engineStore}>
            <PlatformProvider files={files}>
              <App />
            </PlatformProvider>
          </EngineStoreProvider>
        </TransportProvider>
      </I18nextProvider>
    </StrictMode>,
  );
}

void start();
