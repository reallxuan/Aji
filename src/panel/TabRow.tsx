import { cn } from 'cn';
import { useTranslation } from 'react-i18next';
import { panelLabelKey } from '../layout/registry';
import { type PanelRef, refId } from '../layout/model';

/**
 * The quiet tab row of a tab group (layouts mockup, section 1): names only, the active one
 * underlined. A panel alone in its place has no row at all.
 */
export function TabRow({
  panels,
  active,
  onSelect,
}: {
  panels: PanelRef[];
  active: number;
  onSelect(ref: PanelRef): void;
}) {
  const { t } = useTranslation();
  return (
    <div role="tablist" className="flex flex-none gap-[18px] px-6 pt-3 text-[12.5px]">
      {panels.map((ref, i) => (
        <button
          key={refId(ref)}
          type="button"
          role="tab"
          aria-selected={i === active}
          className={cn(
            'pb-1.5',
            i === active
              ? 'text-text shadow-[inset_0_-2px_0_var(--color-text)]'
              : 'text-text-muted',
          )}
          onClick={() => onSelect(ref)}
        >
          {t(panelLabelKey(ref))}
        </button>
      ))}
    </div>
  );
}
