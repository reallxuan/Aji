import { cn } from 'cn';
import { SETTINGS_LABEL, SETTINGS_ROW } from '../settings/rowClasses';
import { LayoutGridIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PANEL_KINDS, type PanelRef, panelsOf, type PresetId, refId, sameRef } from './model';
import { hidePanel, showPanel } from './ops';
import { PRESET_IDS, presetLayout } from './presets';
import { panelLabelKey, panelSpec } from './registry';
import { useDrawnLayout } from './useDrawnLayout';

/**
 * Every panel the 布局 menu can hide or show: each hideable kind, and each sub-board rank. Read
 * when called, not at load: the registry's panels import the game menu, which imports this.
 */
const hideable = (): PanelRef[] =>
  PANEL_KINDS.filter((kind) => panelSpec(kind).hideable).flatMap((kind): PanelRef[] =>
    kind === 'subboard' ? ([1, 2, 3] as const).map((rank) => ({ kind, rank })) : [{ kind }],
  );

/** The 布局 menu's state and choices (design 5.3), wherever it is shown. */
function useLayoutChoices(sideOpen: boolean) {
  const { t } = useTranslation();
  const { drawn, setLayout } = useDrawnLayout(sideOpen);
  const shown = panelsOf(drawn.root);
  return {
    preset: drawn.preset,
    panels: hideable().map((ref) => ({
      ref,
      label:
        ref.kind === 'subboard'
          ? t('layout.subboardRank', { rank: ref.rank })
          : t(panelLabelKey(ref)),
      shown: shown.some((p) => sameRef(p, ref)),
    })),
    choose: (id: PresetId) => setLayout(presetLayout(id)),
    toggle: (ref: PanelRef, show: boolean) =>
      setLayout(show ? showPanel(drawn, ref) : hidePanel(drawn, ref)),
    reset: () => setLayout(presetLayout('default')),
  };
}

/** The 布局 submenu of the game menu: presets, a checkbox per panel, and 恢复默认. */
export function LayoutMenuItems() {
  const { t } = useTranslation();
  const choices = useLayoutChoices(false);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2.5">
        <LayoutGridIcon className="size-4 text-text-muted" aria-hidden />
        {t('layout.menu.title')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44">
        <DropdownMenuRadioGroup
          value={choices.preset}
          onValueChange={(id) => choices.choose(id as PresetId)}
        >
          {PRESET_IDS.map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {t(`layout.menu.presets.${id}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[0.75rem] font-normal text-text-muted">
          {t('layout.menu.panels')}
        </DropdownMenuLabel>
        {choices.panels.map(({ ref, label, shown }) => (
          <DropdownMenuCheckboxItem
            key={refId(ref)}
            checked={shown}
            // The menu stays open, so several panels can be changed in one go.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => choices.toggle(ref, checked)}
          >
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={choices.reset}>{t('layout.menu.reset')}</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * The 布局 rows of 设置 → 界面: the presets (a select, since five names do not fit a narrow column
 * side by side), the panels, and 恢复默认.
 */
export function LayoutSettings() {
  const { t } = useTranslation();
  const choices = useLayoutChoices(true);
  return (
    <>
      <div className={SETTINGS_ROW}>
        <span className={SETTINGS_LABEL}>{t('layout.menu.title')}</span>
        <Select
          value={choices.preset}
          onValueChange={(id) => id !== 'custom' && choices.choose(id as PresetId)}
        >
          <SelectTrigger size="sm" className="w-32" aria-label={t('layout.menu.title')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                {t(`layout.menu.presets.${id}`)}
              </SelectItem>
            ))}
            {/* Named while the layout is custom; never chosen, since a drag makes it so. */}
            {choices.preset === 'custom' && (
              <SelectItem value={choices.preset} disabled>
                {t('layout.menu.custom')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <div className={cn(SETTINGS_ROW, '@md:items-start')}>
        <span className={SETTINGS_LABEL}>{t('layout.menu.panels')}</span>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {choices.panels.map(({ ref, label, shown }) => (
            <label key={refId(ref)} className="flex items-center gap-2">
              <Checkbox
                checked={shown}
                onCheckedChange={(checked) => choices.toggle(ref, checked === true)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className={SETTINGS_ROW}>
        <span className={cn(SETTINGS_LABEL, 'hidden @md:block')} />
        <button
          type="button"
          className="text-[0.8125rem] text-text-muted underline-offset-2 hover:text-text hover:underline"
          onClick={choices.reset}
        >
          {t('layout.menu.reset')}
        </button>
      </div>
    </>
  );
}
