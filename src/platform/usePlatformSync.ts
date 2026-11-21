import { useEffect } from 'react';
import { useDeviceStore } from '../device/deviceStore';
import { useTranslation } from 'react-i18next';
import { runMenuCommand } from '../game/actions';
import { useTransport } from '../transport/TransportProvider';
import { usePlatformFiles } from './PlatformProvider';

/**
 * Keeps the menu bar in the interface's language, runs what is chosen from it, and keeps the
 * window on top when the device says so.
 */
export function usePlatformSync(): void {
  const files = usePlatformFiles();
  const transport = useTransport();
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'zh-CN' ? 'zh-CN' : 'en';

  useEffect(() => {
    files.setMenuLanguage(language).catch(() => {});
  }, [files, language]);
  // Always on top is the device's (P2 M1 design 5.9): applied once the device store has loaded,
  // and whenever it changes.
  const loaded = useDeviceStore((s) => s.loaded);
  const alwaysOnTop = useDeviceStore((s) => s.settings.alwaysOnTop);
  useEffect(() => {
    if (loaded) files.setAlwaysOnTop(alwaysOnTop).catch(() => {});
  }, [files, loaded, alwaysOnTop]);

  useEffect(
    () => files.onMenu((command) => void runMenuCommand({ transport, files, t }, command)),
    [files, transport, t],
  );
}
