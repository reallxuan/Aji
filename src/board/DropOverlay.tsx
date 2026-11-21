import { ArrowDownToLineIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openDropped } from '../game/actions';
import { useActionContext } from '../game/useActionContext';
import { usePlatformFiles } from '../platform/PlatformProvider';

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * While a file is dragged over the window, the board dims under a dashed outline that says
 * dropping opens it (mockup frame F); a drop opens the first file.
 */
export function DropOverlay() {
  const { t } = useTranslation();
  const files = usePlatformFiles();
  const ctx = useActionContext();
  // `null` while nothing is over the window; the name once the system has given it.
  const [over, setOver] = useState<{ name: string | null } | null>(null);

  useEffect(
    () =>
      files.onDrag((event) => {
        if (event.kind === 'over') {
          const path = event.paths?.[0];
          setOver((now) => ({ name: path ? baseName(path) : (now?.name ?? null) }));
        } else {
          setOver(null);
          if (event.kind === 'drop') void openDropped(ctx, event.paths);
        }
      }),
    [files, ctx],
  );

  if (!over) return null;
  return (
    <div
      data-drop-overlay
      className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-overlay-edge bg-overlay-scrim"
    >
      <div className="flex items-center gap-3 rounded-[10px] bg-overlay-card px-[26px] py-4 text-[20px] text-overlay-text">
        <ArrowDownToLineIcon className="size-6" aria-hidden />
        <span>
          {t('notice.dropHere')}
          {over.name && (
            <small className="mt-1 block text-[13px] text-overlay-muted">{over.name}</small>
          )}
        </span>
      </div>
    </div>
  );
}
