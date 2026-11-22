import { cn } from 'cn';
import type { PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { type PanelRef, refId } from './model';
import { panelLabelKey } from './registry';

/**
 * A panel's grip, at its top left (design 5.3): shown while the pointer is over the panel, and
 * faintly at all times for a coarse pointer, where it also takes a full touch target.
 */
export function Grip({
  panel,
  coarse,
  onPointerDown,
}: {
  panel: PanelRef;
  coarse: boolean;
  onPointerDown(e: PointerEvent): void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-grip={refId(panel)}
      aria-label={t('layout.move', { panel: t(panelLabelKey(panel)) })}
      className={cn(
        'absolute top-0 left-0 z-20 flex cursor-grab touch-none items-center justify-center text-text-muted hover:text-text active:cursor-grabbing',
        coarse ? 'size-11 opacity-50' : 'size-6',
      )}
      onPointerDown={onPointerDown}
    >
      <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" fill="currentColor">
        {[0, 1].map((col) =>
          [0, 1, 2].map((row) => (
            <circle key={`${col}${row}`} cx={1.5 + col * 5} cy={1.5 + row * 4.5} r={1.2} />
          )),
        )}
      </svg>
    </button>
  );
}
