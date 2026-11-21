import { CameraIcon } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useGameStore } from '../game/gameStore';
import { gameTitle } from '../game/title';
import { useActionContext } from '../game/useActionContext';
import { copyShot, find, saveShot, TARGETS, type Translate } from './screenshots';

export { copyShot, saveShot, type ShotTarget } from './screenshots';

/** 视图 → 截图 (P2 M1 design 5.9; owner, 2026-11-22): save or copy the board, a sub-board or the graph. */
export function ScreenshotMenuItems() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const snapshot = useGameStore((s) => s.snapshot);
  const tr: Translate = (key, options) => (options ? t(key, options) : t(key));
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2.5">
        <CameraIcon className="size-4 text-text-muted" aria-hidden />
        {t('screenshot.title')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44">
        {/* Rendered when the submenu opens, so it sees what is on screen then. */}
        {TARGETS.map((target, i) => {
          const shown = find(target) !== null;
          const name = t(`screenshot.targets.${target}`);
          return (
            <Fragment key={target}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={!shown}
                onSelect={() => void saveShot(target, ctx.files, gameTitle(snapshot, t), tr)}
              >
                {t('screenshot.save', { target: name })}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!shown}
                onSelect={() => void copyShot(target, ctx.files, tr)}
              >
                {t('screenshot.copy', { target: name })}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
