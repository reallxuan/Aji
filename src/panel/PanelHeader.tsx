import { SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePanelStore } from '../app/panelStore';
import { cn } from 'cn';
import { EngineIndicator } from './EngineIndicator';
import { GameMenu } from './GameMenu';
import { MoveCounter } from './MoveCounter';
import { NavButtons } from './NavButtons';
import { RulesChip } from './RulesChip';
import { ViewMenu } from './ViewMenu';
import { useOs } from '../app/useOs';

const openSettings = () => usePanelStore.getState().show('settings');

/**
 * The analysis panel's header (design 5.7): the game title and its menu, the rules chip, move
 * navigation, the engine dot and the gear. While it shows, the board's keys work. In a narrow
 * panel (under 500 px) the chip shows only the komi and the first and last buttons step aside,
 * so the title keeps room; Home, End and the counter still reach both ends.
 */
export function PanelHeader({
  compact = false,
  touch = false,
}: {
  /** The phone header (P2 M1 design 5.5): title, move counter, engine dot and gear. */
  compact?: boolean;
  /** Touch targets of at least 44 px. */
  touch?: boolean;
} = {}) {
  const { t } = useTranslation();
  const os = useOs();
  return (
    <header
      className={cn('@container flex-none border-b border-hairline', compact ? 'h-[52px]' : 'h-14')}
    >
      <div className="flex h-full items-center gap-2.5 pr-[18px] pl-6 @max-[500px]:gap-1.5">
        <div className="flex min-w-0 flex-1 items-center">
          <GameMenu />
        </div>
        {compact ? (
          <MoveCounter />
        ) : (
          <>
            <RulesChip />
            <NavButtons touch={touch} />
          </>
        )}
        <EngineIndicator touch={touch} />
        {/* On the Mac, 布局 and 截图 are in the menu bar's 显示 and 文件 menus. */}
        {os !== null && os !== 'macos' && <ViewMenu touch={touch} />}
        <button
          type="button"
          className={cn(
            'flex flex-none items-center justify-center rounded-sm text-text-muted hover:text-text',
            touch ? 'min-h-11 min-w-11' : 'size-7',
          )}
          aria-label={t('panel.settings')}
          onClick={openSettings}
        >
          <SettingsIcon className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}
