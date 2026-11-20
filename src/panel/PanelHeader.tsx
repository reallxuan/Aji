import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SettingsIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePanelStore } from '../app/panelStore';
import { EngineIndicator } from './EngineIndicator';

const openSettings = () => usePanelStore.getState().show('settings');

/**
 * The analysis panel's header: the game title, move navigation, the engine dot and the gear.
 * Games and navigation arrive in M6; until then the title is a placeholder and the arrows are inert.
 */
export function PanelHeader() {
  const { t } = useTranslation();
  const nav =
    'flex size-7 items-center justify-center rounded-sm text-text-muted disabled:opacity-40';
  return (
    <header className="flex items-center gap-3 border-b border-hairline px-6 py-3.5">
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{t('panel.untitled')}</span>
      <div className="flex items-center gap-0.5">
        <button type="button" className={nav} disabled aria-label={t('panel.first')}>
          <SkipBackIcon className="size-3.5" aria-hidden />
        </button>
        <button type="button" className={nav} disabled aria-label={t('panel.previous')}>
          <ChevronLeftIcon className="size-4" aria-hidden />
        </button>
        <span className="px-1.5 text-[12px] text-text-muted tabular-nums">
          {t('panel.moveCounter', { current: 0, total: 0 })}
        </span>
        <button type="button" className={nav} disabled aria-label={t('panel.next')}>
          <ChevronRightIcon className="size-4" aria-hidden />
        </button>
        <button type="button" className={nav} disabled aria-label={t('panel.last')}>
          <SkipForwardIcon className="size-3.5" aria-hidden />
        </button>
      </div>
      <EngineIndicator />
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded-sm text-text-muted hover:text-text"
        aria-label={t('panel.settings')}
        onClick={openSettings}
      >
        <SettingsIcon className="size-4" aria-hidden />
      </button>
    </header>
  );
}
