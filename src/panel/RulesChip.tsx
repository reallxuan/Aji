import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { useGameStore } from '../game/gameStore';
import { formatKomi, komiOf } from '../game/komi';
import { GameInfoSurface } from './GameInfoPopover';

/**
 * The rules and komi KataGo analyses with (`中国 7.5`), beside the title. An amber dot marks a
 * change from the file's reading. Opens the game information popover.
 */
export function RulesChip({ narrow = false }: { narrow?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const rules = useGameStore((s) => s.snapshot?.rules);
  if (!rules) return null;
  const parts = {
    rules: t(`rules.short.${rules.current.kind}`),
    komi: formatKomi(komiOf(rules.current)),
  };
  const label = t('rules.chip', parts);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex flex-none items-center gap-1.5 rounded-full border border-hairline px-2.5 py-0.5 text-[0.75rem] whitespace-nowrap text-text-muted hover:bg-divider-soft hover:text-text data-[state=open]:bg-divider-soft data-[state=open]:text-text data-[changed=true]:border-line data-[changed=true]:text-text"
        data-changed={rules.changed}
        aria-label={rules.changed ? t('rules.chipChanged', parts) : label}
      >
        {rules.changed && (
          <span
            data-changed-dot
            className="size-[5px] flex-none rounded-full bg-score"
            aria-hidden
          />
        )}
        <span className="@max-[500px]:hidden">{label}</span>
        <span data-compact className="hidden @max-[500px]:inline">
          {parts.komi}
        </span>
      </PopoverTrigger>
      <GameInfoSurface narrow={narrow} open={open} onClose={() => setOpen(false)} />
    </Popover>
  );
}
