import { cn } from 'cn';
import { ChevronDownIcon } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePanelStore } from '../app/panelStore';
import { useActionContext } from '../game/useActionContext';
import { middleTruncate } from '../panel/EngineCard';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import { useAddEngineStore } from './addEngineStore';
import { openConsole } from './openConsole';
import { switchProfileAsking, useProfileStore } from './profileStore';

/** How many characters of a profile's name the chip shows. */
const CHIP_CHARS = 16;
const DEV = 'dev';

const openEngineSettings = () => usePanelStore.getState().show('settings', 'engine');

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** A profile's second line: its network and speed, or that it runs one's own files. */
export function profileDetail(profile: ProfileSummary, t: TFunction, language: string): string {
  const { source } = profile;
  if (source.kind === 'own')
    return t('engine.profile.detail', {
      network: t('engine.profile.ownFiles'),
      speed: fileName(source.model),
    });
  const speed =
    source.visitsPerSecond === null
      ? t('engine.profile.unmeasured')
      : t('engine.profile.speed', {
          speed: Math.round(source.visitsPerSecond).toLocaleString(language),
        });
  return t('engine.profile.detail', { network: source.networkName, speed });
}

/**
 * The profile chip left of the engine dot (P2 M4 design 6.2): the current profile's name, and a
 * menu that switches profiles, adds one, or opens Settings at the engine section.
 */
export function ProfileChip() {
  const { t, i18n } = useTranslation();
  const ctx = useActionContext();
  const profiles = useProfileStore((s) => s.profiles);
  const devOverride = useProfileStore((s) => s.devOverride);
  const current = profiles.find((p) => p.current);
  if (!current && !devOverride) return null;
  const label = devOverride ? t('engine.profile.dev') : middleTruncate(current!.name, CHIP_CHARS);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={devOverride ? t('engine.profile.devEntry') : current!.name}
        className={cn(
          // It gives way before the gear does: in a narrow header the name is cut further.
          'flex h-7 max-w-[11rem] min-w-[3.5rem] shrink items-center gap-1 rounded-full border border-hairline px-2.5 text-xs text-text-muted',
          'hover:text-text data-[state=open]:border-text-muted data-[state=open]:text-text',
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="size-3 flex-none" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[340px]">
        <DropdownMenuLabel className="text-[11px] font-normal text-text-muted">
          {t('engine.profile.menuTitle')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={devOverride ? DEV : (current?.id ?? '')}
          onValueChange={(id) => void switchProfileAsking(ctx, id)}
        >
          {devOverride && (
            <DropdownMenuRadioItem value={DEV} disabled>
              {t('engine.profile.devEntry')}
            </DropdownMenuRadioItem>
          )}
          {profiles.map((profile) => (
            <DropdownMenuRadioItem
              key={profile.id}
              value={profile.id}
              disabled={devOverride}
              className="items-start"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">{profile.name}</div>
                <div className="truncate text-[11.5px] text-text-muted">
                  {profileDetail(profile, t, i18n.language)}
                </div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => useAddEngineStore.getState().setOpen(true)}>
          {t('engine.profile.add')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openConsole}>{t('engine.profile.console')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={openEngineSettings}>
          {t('engine.profile.manage')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
