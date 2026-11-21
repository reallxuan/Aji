import { SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePanelStore } from '../app/panelStore';
import { EngineIndicator } from './EngineIndicator';
import { GameMenu } from './GameMenu';
import { NavButtons } from './NavButtons';
import { RulesChip } from './RulesChip';

const openSettings = () => usePanelStore.getState().show('settings');

/**
 * The analysis panel's header (design 5.7): the game title and its menu, the rules chip, move
 * navigation, the engine dot and the gear. While it shows, the board's keys work. In a narrow
 * panel (under 500 px) the chip shows only the komi and the first and last buttons step aside,
 * so the title keeps room; Home, End and the counter still reach both ends.
 */
export function PanelHeader() {
  const { t } = useTranslation();
  return (
    <header className="@container h-14 flex-none border-b border-hairline">
      <div className="flex h-full items-center gap-2.5 pr-[18px] pl-6 @max-[500px]:gap-1.5">
        <div className="flex min-w-0 flex-1 items-center">
          <GameMenu />
        </div>
        <RulesChip />
        <NavButtons />
        <EngineIndicator />
        <button
          type="button"
          className="flex size-7 flex-none items-center justify-center rounded-sm text-text-muted hover:text-text"
          aria-label={t('panel.settings')}
          onClick={openSettings}
        >
          <SettingsIcon className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}
