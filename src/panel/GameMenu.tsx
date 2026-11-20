import { ChevronDownIcon, FolderOpenIcon, HistoryIcon, PlusIcon, SaveIcon } from 'lucide-react';
import { useState } from 'react';
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
import { shortcut, useOs } from '../app/useOs';
import { openFromPicker, openRecent, saveAs, startNewGame } from '../game/actions';
import { useGameStore } from '../game/gameStore';
import { gameTitle } from '../game/title';
import { useActionContext } from '../game/useActionContext';
import type { RecentEntry } from '../platform/files';

const DAY = 24 * 60 * 60 * 1000;
const SIZES = [19, 13, 9] as const;
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
        <span className="block truncate text-[12px] text-text-muted in-data-missing:text-line">
          {entry.missing ? t('menu.missing') : entry.name}
        </span>
      </span>
      <span className="text-[12px] whitespace-nowrap text-text-muted">
        {when(entry.openedAt, i18n.language, t('menu.today'), t('menu.yesterday'))}
      </span>
    </DropdownMenuItem>
  ));
}

/**
 * The title, which opens the game menu (design 5.7, mockup frame B): new game by size, open,
 * open recent, and save as.
 */
export function GameMenu() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const os = useOs();
  const snapshot = useGameStore((s) => s.snapshot);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const title = gameTitle(snapshot, t);
  const icon = 'size-4 text-text-muted';

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) ctx.files.recent().then(setRecent, () => setRecent([]));
      }}
    >
      <DropdownMenuTrigger className="group -ml-1.5 flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-[14px] font-medium hover:bg-divider-soft data-[state=open]:bg-divider-soft">
        <span className="truncate">{title}</span>
        <ChevronDownIcon
          className="size-3.5 flex-none text-text-muted group-data-[state=open]:text-text"
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-56">
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
              className="text-[12.5px] text-text-muted"
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
