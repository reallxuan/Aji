import { create } from 'zustand';
import type { CacheStats } from '../transport/generated/CacheStats';

/** The analysis cache's size and whether its file is in use (P2 M2 design 5.2). */
export interface CacheState {
  /** `null` until the backend has said. */
  stats: CacheStats | null;
  /** The not-kept notice has been shown this session. */
  noticed: boolean;
  setStats(stats: CacheStats): void;
  markNoticed(): void;
}

export const useCacheStore = create<CacheState>()((set) => ({
  stats: null,
  noticed: false,
  setStats: (stats) => set({ stats }),
  markNoticed: () => set({ noticed: true }),
}));

/** Tests: nothing known, nothing noticed. */
export function resetCacheStore(): void {
  useCacheStore.setState({ stats: null, noticed: false });
}
