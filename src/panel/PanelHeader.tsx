import { usePlatformFiles } from '../platform/PlatformProvider';
import { usePanelWidth } from '../layout/usePanelWidth';
import { PHONE_STATUS_HEIGHT } from '../layout/constants';
import { useGameStore } from '../game/gameStore';
import { SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePanelStore } from '../app/panelStore';
import { cn } from 'cn';
import { ProfileChip } from '../engine/ProfileChip';
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
  narrow = false,
}: {
  /** The phone header (P2 M1 design 5.5): title, move counter, engine dot and gear. */
  compact?: boolean;
  /** Touch targets of at least 44 px. */
  touch?: boolean;
  narrow?: boolean;
} = {}) {
  const { t } = useTranslation();
  const tryout = useGameStore((s) => s.snapshot?.tryout != null);
  const changed = useGameStore((s) => !!s.snapshot?.changed);
  const panelWidth = usePanelWidth();
  const separateStatus = compact || (panelWidth > 0 && panelWidth < 680);
  const os = useOs();
  const { browserMenus } = usePlatformFiles();
  const status = (tryout || changed) && (
    <div
      role="status"
      className={cn('flex shrink-0 items-center gap-1.5', separateStatus && 'px-3')}
      style={separateStatus ? { height: PHONE_STATUS_HEIGHT } : undefined}
    >
      {tryout && (
        <span className="flex-none whitespace-nowrap rounded-full border border-amber-600/50 px-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          {t('edit.trying')}
        </span>
      )}
      {changed && (
        <span className="flex-none whitespace-nowrap rounded-full border border-hairline px-1.5 text-[11px] text-text-muted">
          {t('title.changed')}
        </span>
      )}
    </div>
  );
  return (
    <header className="@container flex-none border-b border-hairline">
      <div
        className={cn(
          'flex items-center gap-2.5 @max-[500px]:gap-1.5',
          compact ? 'h-[51px] px-3' : 'h-[55px] pr-[18px] pl-6',
          !narrow && !compact && 'pl-[30px] pointer-coarse:pl-[50px]',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center">
          <GameMenu touch={touch || compact} narrow={narrow} />
        </div>
        {!separateStatus && status}
        {compact ? (
          <MoveCounter />
        ) : (
          <>
            <RulesChip narrow={narrow} />
            <NavButtons touch={touch} />
          </>
        )}
        {/* The phone has no room: its profiles are in Settings (P2 M4 design 6.2). */}
        {!compact && <ProfileChip />}
        <EngineIndicator touch={touch} />
        {/* On the Mac, 布局 and 截图 are in the menu bar's 显示 and 文件 menus. */}
        {(compact || browserMenus || (os !== null && os !== 'macos')) && <ViewMenu touch={touch} />}
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
      {separateStatus && status}
    </header>
  );
}
