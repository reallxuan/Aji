import {
  CalculatorIcon,
  ChevronDownIcon,
  EraserIcon,
  FolderOpenIcon,
  HistoryIcon,
  PlusIcon,
  SaveIcon,
  ScanSearchIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { shortcut, useOs } from '../app/useOs';
import { openFromPicker, openRecent, saveAs, startNewGame } from '../game/actions';
import { useGameStore } from '../game/gameStore';
import { gameTitle } from '../game/title';
import { useEngineStoreApi } from '../engine/engineStore';
import { useActionContext } from '../game/useActionContext';
import { clearAnalysis, openJobPanel } from '../job/actions';
import { JobPanelContent } from '../job/JobPanel';
import { useJobPanelStore } from '../job/jobPanelStore';
import { useScoringStore } from '../scoring/scoringStore';
import type { RecentEntry } from '../platform/files';
import type { CacheScope } from '../transport/generated/CacheScope';

const DAY = 24 * 60 * 60 * 1000;
const SIZES = [19, 13, 9] as const;
/** The job panel's 开始, which takes the focus so Return starts. */
const START_BUTTON = '[data-start]';
/** 清除分析结果 ▸ 本局面 / 整局. */
const CLEAR_SCOPES: Array<[CacheScope, string]> = [
  ['position', 'menu.clearPosition'],
  ['game', 'menu.clearGame'],
];
/** Shortcut keys, the same in every language. */
const [N, O, S] = ['N', 'O', 'S'];

/** 今天, 昨天, else the month and day in the interface language. */
function when(openedAt: number, language: string, today: string, yesterday: string): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (openedAt >= start.getTime()) return today;
  if (openedAt >= start.getTime() - DAY) return yesterday;
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(openedAt);
}

function RecentItems({ entries }: { entries: RecentEntry[] }) {
  const { t, i18n } = useTranslation();
  const ctx = useActionContext();
  if (entries.length === 0)
    return (
      <DropdownMenuItem disabled className="text-text-muted">
        {t('menu.noRecent')}
      </DropdownMenuItem>
    );
  return entries.map((entry, index) => (
    <DropdownMenuItem
      key={entry.path}
      title={entry.path}
      data-missing={entry.missing || undefined}
      className="items-start gap-3"
      onSelect={() => void openRecent(ctx, index)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate in-data-missing:text-line">
          {entry.title || entry.name}
        </span>
        <span className="block truncate text-[0.75rem] text-text-muted in-data-missing:text-line">
          {entry.missing ? t('menu.missing') : entry.name}
        </span>
      </span>
      <span className="text-[0.75rem] whitespace-nowrap text-text-muted">
        {when(entry.openedAt, i18n.language, t('menu.today'), t('menu.yesterday'))}
      </span>
    </DropdownMenuItem>
  ));
}

/**
 * The title, which opens the game menu (design 5.7, mockup frame B): new game by size, open,
 * open recent and save as, then 分析全局…, 清除分析结果 and 终局点目 (P2 M2 design 5.10). 布局
 * and 截图 are in the menu bar or the 视图 button (owner, 2026-11-22). 分析全局… drops its panel
 * from the title, as the rules chip drops its own.
 */
export function GameMenu() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const engine = useEngineStoreApi();
  const os = useOs();
  const snapshot = useGameStore((s) => s.snapshot);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const panelOpen = useJobPanelStore((s) => s.open);
  const setPanelOpen = useJobPanelStore((s) => s.setOpen);
  // Escape gives focus back to the trigger, as a menu should; after a choice it stays off it,
  // so ↓ steps the game instead of reopening the menu (M6 minor #8).
  const escaped = useRef(false);
  const title = gameTitle(snapshot, t);
  const icon = 'size-4 text-text-muted';

  return (
    <Popover open={panelOpen} onOpenChange={setPanelOpen}>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) return;
          escaped.current = false;
          ctx.files.recent().then(setRecent, () => setRecent([]));
        }}
      >
        <PopoverAnchor asChild>
          <DropdownMenuTrigger className="group -ml-1.5 flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-[0.875rem] font-medium hover:bg-divider-soft data-[state=open]:bg-divider-soft">
            <span className="truncate">{title}</span>
            <ChevronDownIcon
              className="size-3.5 flex-none text-text-muted group-data-[state=open]:text-text"
              aria-hidden
            />
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-56"
          onEscapeKeyDown={() => (escaped.current = true)}
          onCloseAutoFocus={(event) => {
            if (escaped.current) return;
            event.preventDefault();
            // 分析全局… takes focus into its panel.
            if (useJobPanelStore.getState().open) return;
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }}
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5">
              <PlusIcon className={icon} aria-hidden />
              {t('menu.newGame')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              {SIZES.map((size) => (
                <DropdownMenuItem key={size} onSelect={() => void startNewGame(ctx, size)}>
                  {t(`menu.size${size}`)}
                  {size === 19 && <DropdownMenuShortcut>{shortcut(os, N)}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem className="gap-2.5" onSelect={() => void openFromPicker(ctx)}>
            <FolderOpenIcon className={icon} aria-hidden />
            {t('menu.open')}
            <DropdownMenuShortcut>{shortcut(os, O)}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5">
              <HistoryIcon className={icon} aria-hidden />
              {t('menu.openRecent')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72">
              <RecentItems entries={recent} />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-[0.78125rem] text-text-muted"
                disabled={recent.length === 0}
                onSelect={() => {
                  setRecent([]);
                  void ctx.files.clearRecent().catch(() => {});
                }}
              >
                {t('menu.clearRecent')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2.5"
            disabled={!snapshot?.hasMoves}
            onSelect={() => void saveAs(ctx)}
          >
            <SaveIcon className={icon} aria-hidden />
            {t('menu.saveAs')}
            <DropdownMenuShortcut>{shortcut(os, S, true)}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2.5" onSelect={openJobPanel}>
            <ScanSearchIcon className={icon} aria-hidden />
            {t('menu.analyseGame')}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5">
              <EraserIcon className={icon} aria-hidden />
              {t('menu.clearAnalysis')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              {CLEAR_SCOPES.map(([scope, label]) => (
                <DropdownMenuItem key={scope} onSelect={() => void clearAnalysis(ctx, scope)}>
                  {t(label)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            className="gap-2.5"
            disabled={!snapshot?.hasMoves}
            onSelect={() =>
              void useScoringStore.getState().start({ transport: ctx.transport, engine, t: ctx.t })
            }
          >
            <CalculatorIcon className={icon} aria-hidden />
            {t('menu.finalScoring')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-auto p-0"
        onOpenAutoFocus={(event) => {
          // Return starts: 开始 has the focus.
          event.preventDefault();
          const start = (event.currentTarget as HTMLElement).querySelector(START_BUTTON);
          if (start instanceof HTMLElement) start.focus();
        }}
      >
        <JobPanelContent onDone={() => setPanelOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
