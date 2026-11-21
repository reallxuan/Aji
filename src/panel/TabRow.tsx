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
  label,
  touch = false,
}: {
  panels: PanelRef[];
  active: number;
  onSelect(ref: PanelRef): void;
  /** A tab's name; by default its panel's. */
  label?(ref: PanelRef): string;
  /** Touch targets of at least 44 px. */
  touch?: boolean;
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
            touch && 'min-h-11 min-w-11',
            i === active
              ? 'text-text shadow-[inset_0_-2px_0_var(--color-text)]'
              : 'text-text-muted',
          )}
          onClick={() => onSelect(ref)}
        >
          {label ? label(ref) : t(panelLabelKey(ref))}
        </button>
      ))}
    </div>
  );
}
