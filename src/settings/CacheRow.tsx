import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCacheStore } from '../cache/cacheStore';
import { formatBytes } from '../setup/format';
import { clearCache, getCacheStats } from '../transport/api';
import type { Transport } from '../transport/transport';
import { SETTINGS_LABEL, SETTINGS_ROW } from './rowClasses';

const MB = 1024 * 1024;
/** The size caps offered, in megabytes (design 5.2: 1 GB by default). */
export const CACHE_CAPS_MB = [256, 512, 1024, 2048, 4096];

/**
 * 分析缓存 (P2 M2 design 5.9): the space used and the cap, a cap to choose, and 清除… for
 * everything, asked first. When the file can't be used the row says so, and why.
 */
export function CacheRow({
  transport,
  capMb,
  disabled,
  onCap,
}: {
  transport: Transport;
  capMb: number;
  disabled: boolean;
  onCap(capMb: number): void;
}) {
  const { t, i18n } = useTranslation();
  const stats = useCacheStore((s) => s.stats);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(
    () =>
      getCacheStats(transport).then(
        (next) => useCacheStore.getState().setStats(next),
        () => {
          // The row keeps what it showed.
        },
      ),
    [transport],
  );
  // Asked each time settings open; the app's sync keeps it after that.
  useEffect(() => void refresh(), [refresh]);

  const clearAll = async () => {
    setConfirming(false);
    setFailed(false);
    try {
      await clearCache(transport, 'all');
    } catch {
      setFailed(true);
    }
    await refresh();
  };

  const size = (bytes: number) => formatBytes(bytes, i18n.language);
  // The cap chosen may be newer than the stats' (a change saving); the list shows the setting.
  const caps = CACHE_CAPS_MB.includes(capMb) ? CACHE_CAPS_MB : [...CACHE_CAPS_MB, capMb];

  return (
    <>
      <div className={SETTINGS_ROW}>
        <span className={SETTINGS_LABEL}>{t('settings.cache.title')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(capMb)}
            disabled={disabled}
            onValueChange={(value) => onCap(Number(value))}
          >
            <SelectTrigger size="sm" className="w-28" aria-label={t('settings.cache.cap')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {caps.map((mb) => (
                <SelectItem key={mb} value={String(mb)}>
                  {size(mb * MB)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            {t('settings.cache.clear')}
          </Button>
        </div>
      </div>
      {stats && (
        <div className="text-[0.75rem] text-text-muted">
          {stats.persistent ? (
            <p>
              {t('settings.cache.used', { used: size(stats.usedBytes), cap: size(capMb * MB) })}
            </p>
          ) : (
            <>
              <p className="text-text">{t('settings.cache.memoryOnly')}</p>
              {stats.reason && <p>{t('settings.cache.reason', { reason: stats.reason })}</p>}
            </>
          )}
        </div>
      )}
      {failed && (
        <p role="alert" className="text-[0.8125rem] text-engine-error">
          {t('settings.cache.failed')}
        </p>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>{t('settings.cache.confirmTitle')}</DialogTitle>
          <DialogDescription>{t('settings.cache.confirmBody')}</DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('settings.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void clearAll()}>
              {t('settings.cache.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
