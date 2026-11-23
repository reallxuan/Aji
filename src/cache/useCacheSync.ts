import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNoticeStore } from '../game/noticeStore';
import { cacheNotice } from '../game/notices';
import { getCacheStats } from '../transport/api';
import type { CacheStats } from '../transport/generated/CacheStats';
import { useTransport } from '../transport/TransportProvider';
import { useCacheStore } from './cacheStore';

/**
 * Keeps the cache store on the backend: asked once at start, then each `cacheStatus` event. When
 * the file can't be used, one notice line per session says results aren't kept (design 5.2).
 */
export function useCacheSync(): void {
  const transport = useTransport();
  const { t } = useTranslation();
  useEffect(() => {
    const take = (stats: CacheStats) => {
      const store = useCacheStore.getState();
      store.setStats(stats);
      const notice = cacheNotice(stats, t);
      if (notice && !store.noticed) {
        store.markNoticed();
        useNoticeStore.getState().show(notice);
      }
    };
    let active = true;
    getCacheStats(transport).then(
      (stats) => {
        if (active) take(stats);
      },
      () => {
        // No answer: the settings row asks again when it opens.
      },
    );
    const unsubscribe = transport.subscribe((event) => {
      if (event.type === 'cacheStatus') take(event.status);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [transport, t]);
}
