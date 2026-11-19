import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { applyTheme, readSystemTheme, resolveTheme } from './theme/theme';

// Set the theme before the first render so the first frame already has the right ground colour.
applyTheme(resolveTheme('system', readSystemTheme(window.matchMedia?.bind(window))));

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
