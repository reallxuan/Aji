import { cn } from 'cn';
import { EllipsisIcon } from 'lucide-react';
import type { TFunction } from 'i18next';
import { type Ref, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAddEngineStore } from '../engine/addEngineStore';
import { openConsole } from '../engine/openConsole';
import { switchProfileAsking, useProfileStore } from '../engine/profileStore';
import { useActionContext } from '../game/useActionContext';
import { backendName } from '../setup/labels';
import { removeProfile, renameProfile } from '../transport/api';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import { toTransportError } from '../transport/transport';

const DEV = 'dev';
const openAdd = () => useAddEngineStore.getState().setOpen(true);

/** A row's second line (P2 M4 design 6.4): build, network, threads and speed, or the own files. */
function rowDetail(profile: ProfileSummary, t: TFunction, language: string): string {
  const { source } = profile;
  if (source.kind === 'own') return t('settings.profile.ownDetail', { katago: source.katago });
  const speed =
    source.visitsPerSecond === null
      ? t('engine.profile.unmeasured')
      : t('engine.profile.speed', {
          speed: Math.round(source.visitsPerSecond).toLocaleString(language),
        });
  return t('settings.profile.detail', {
    build: t('settings.engineLine', {
      version: source.version,
      backend: backendName(t, source.backend),
    }),
    network: source.networkName,
    threads: source.threads,
    speed,
  });
}

/**
 * The engine profiles in Settings (P2 M4 design 6.4): a radio switches, each row's ⋯ menu renames
 * or removes, and 添加引擎… sits under the list. Read again whenever Settings shows it.
 */
export function ProfileList({ onError }: { onError(message: string): void }) {
  const { t, i18n } = useTranslation();
  const ctx = useActionContext();
  const profiles = useProfileStore((s) => s.profiles);
  const devOverride = useProfileStore((s) => s.devOverride);
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameNext = useRef(false);
  const nameField = useRef<HTMLInputElement>(null);
  const current = profiles.find((p) => p.current);

  useEffect(() => {
    void useProfileStore.getState().load(ctx.transport);
  }, [ctx.transport]);

  const change = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (failure) {
      onError(t(`errors.${toTransportError(failure).code}`));
    }
    await useProfileStore.getState().load(ctx.transport);
  };

  const rename = (id: string, name: string) => {
    setRenaming(null);
    void change(() => renameProfile(ctx.transport, id, name));
  };

  return (
    <div className="space-y-1">
      <RadioGroup
        // One track no wider than the panel: a long second line truncates, the ⋯ stays in view.
        className="grid-cols-[minmax(0,1fr)] gap-0"
        value={devOverride ? DEV : (current?.id ?? '')}
        onValueChange={(id) => void switchProfileAsking(ctx, id)}
      >
        {devOverride && (
          <div className="flex min-h-10 items-center gap-3 py-1.5 pointer-coarse:min-h-11">
            <RadioGroupItem value={DEV} disabled aria-label={t('engine.profile.devEntry')} />
            <span className="text-[0.875rem]">{t('engine.profile.devEntry')}</span>
          </div>
        )}
        {profiles.map((profile) => (
          <div
            key={profile.id}
            data-profile={profile.id}
            className="flex min-h-10 items-center gap-3 py-1.5 pointer-coarse:min-h-11"
          >
            <RadioGroupItem value={profile.id} disabled={devOverride} aria-label={profile.name} />
            <div className="min-w-0 flex-1">
              {renaming === profile.id ? (
                <RenameField
                  ref={nameField}
                  name={profile.name}
                  onSave={(name) => rename(profile.id, name)}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <div className="flex items-center gap-1.5 text-[0.875rem]">
                  <span className="truncate">{profile.name}</span>
                  {profile.source.kind === 'own' && (
                    <span className="flex-none rounded-full border border-hairline px-1.5 text-[11px] text-text-muted">
                      {t('engine.profile.ownFiles')}
                    </span>
                  )}
                </div>
              )}
              <div className="truncate text-[0.75rem] text-text-muted">
                {rowDetail(profile, t, i18n.language)}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('settings.profile.more')}
                className={cn(
                  'flex size-7 flex-none items-center justify-center rounded-sm text-text-muted',
                  'hover:text-text data-[state=open]:text-text pointer-coarse:size-11',
                )}
              >
                <EllipsisIcon className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                // The name field takes focus once the menu lets it go, rather than ⋯ getting it
                // back: focusing it while the menu is still open does not hold.
                onCloseAutoFocus={(event) => {
                  if (renameNext.current) {
                    event.preventDefault();
                    nameField.current?.focus();
                    nameField.current?.select();
                  }
                  renameNext.current = false;
                }}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    renameNext.current = true;
                    setRenaming(profile.id);
                  }}
                >
                  {t('settings.profile.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={profile.current}
                  title={profile.current ? t('settings.profile.removeCurrent') : undefined}
                  onSelect={() => void change(() => removeProfile(ctx.transport, profile.id))}
                >
                  {t('settings.profile.remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </RadioGroup>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={openAdd}>
          {t('engine.profile.add')}
        </Button>
        <Button variant="outline" size="sm" onClick={openConsole}>
          {t('engine.profile.console')}
        </Button>
      </div>
    </div>
  );
}

/** The inline name field: Enter saves, Esc cancels. */
function RenameField({
  ref,
  name,
  onSave,
  onCancel,
}: {
  ref: Ref<HTMLInputElement>;
  name: string;
  onSave(name: string): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(name);
  return (
    <input
      ref={ref}
      type="text"
      aria-label={t('settings.profile.name')}
      className="h-7 w-full rounded-md border border-hairline bg-transparent px-2 text-[0.875rem] outline-none focus-visible:border-text-muted"
      value={draft}
      maxLength={80}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        // This Enter picks the input method's text, it does not save.
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') onSave(draft);
        else if (event.key === 'Escape') {
          // Esc here closes the field, not Settings.
          event.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}
