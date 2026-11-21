import { cn } from 'cn';
import { PanelsTopLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LayoutMenuItems } from '../layout/LayoutMenu';
import { ScreenshotMenuItems } from './ScreenshotMenu';

/**
 * 视图 (owner, 2026-11-22): 布局 and 截图 where there is no menu bar to hold them, which is
 * Windows and the browser. The game menu keeps to the game.
 */
export function ViewMenu({ touch = false }: { touch?: boolean }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('menu.view')}
        title={t('menu.view')}
        className={cn(
          'flex flex-none items-center justify-center rounded-sm text-text-muted hover:text-text data-[state=open]:text-text',
          touch ? 'min-h-11 min-w-11' : 'size-7',
        )}
      >
        <PanelsTopLeftIcon className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-48">
        <ScreenshotMenuItems />
        <LayoutMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
