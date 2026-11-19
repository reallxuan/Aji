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
import { TransportProvider } from './transport/TransportProvider';

// Set the theme before the first render so the first frame already has the right ground colour.
applyTheme(resolveTheme('system', readSystemTheme(window.matchMedia?.bind(window))));

const engineStore = createEngineStore();
const i18n = createI18n(resolveLanguage('system', navigator.languages));

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <TransportProvider transport={createTauriTransport()}>
        <EngineStoreProvider store={engineStore}>
          <App />
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>
  </StrictMode>,
);
