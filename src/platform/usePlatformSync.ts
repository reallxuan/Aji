import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { runMenuCommand } from '../game/actions';
import { useTransport } from '../transport/TransportProvider';
import { usePlatformFiles } from './PlatformProvider';

/** Keeps the menu bar in the interface's language, and runs what is chosen from it. */
export function usePlatformSync(): void {
  const files = usePlatformFiles();
  const transport = useTransport();
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'zh-CN' ? 'zh-CN' : 'en';

  useEffect(() => {
    files.setMenuLanguage(language).catch(() => {});
  }, [files, language]);

  useEffect(
    () => files.onMenu((command) => void runMenuCommand({ transport, files, t }, command)),
    [files, transport, t],
  );
}
