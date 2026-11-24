import { XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A full-window sheet with a close control (P2 M1 design 5.5): the wizard, settings and About in
 * the narrow arrangement. Without `onClose` it has no close control (a running install).
 */
export function Sheet({
  children,
  onClose,
  ...props
}: Omit<ComponentProps<'div'>, 'onClose'> & { onClose?(): void }) {
  const { t } = useTranslation();
  return (
    <div
      {...props}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex flex-col bg-panel"
    >
      <div className="flex min-h-12 flex-none justify-end px-1 pt-1">
        {onClose && (
          <button
            type="button"
            aria-label={t('layout.narrow.close')}
            className="flex min-h-11 min-w-11 items-center justify-center text-text-muted hover:text-text"
            onClick={onClose}
          >
            <XIcon className="size-5" aria-hidden />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
