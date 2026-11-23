import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useGameStore } from '../game/gameStore';
import { formatKomi, komiOf } from '../game/komi';
import { GameInfoContent } from './GameInfoPopover';

/**
 * The rules and komi KataGo analyses with (`中国 7.5`), beside the title. An amber dot marks a
 * change from the file's reading. Opens the game information popover.
 */
export function RulesChip() {
  const { t } = useTranslation();
  const rules = useGameStore((s) => s.snapshot?.rules);
  if (!rules) return null;
  const parts = {
    rules: t(`rules.short.${rules.current.kind}`),
    komi: formatKomi(komiOf(rules.current)),
  };
  const label = t('rules.chip', parts);
  return (
    <Popover>
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
      <PopoverContent align="start" sideOffset={6} collisionPadding={12} className="w-auto p-0">
        <GameInfoContent />
      </PopoverContent>
    </Popover>
  );
}
