import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { useGameStore, resetGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { createFakeTransport } from '../transport/fake';
import { TransportProvider } from '../transport/TransportProvider';
import { resetJobStore, useJobStore } from './jobStore';
import { useJobSync } from './useJobSync';

afterEach(() => {
  resetJobStore();
  resetGameStore();
});

it.each(['done', 'paused'] as const)(
  'keeps coverage when switching lines after %s, until reset',
  (state) => {
    const transport = createFakeTransport(() => ({ type: 'ok' }));
    renderHook(() => useJobSync(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <TransportProvider transport={transport}>{children}</TransportProvider>
      ),
    });
    act(() =>
      transport.emit({
        type: 'jobProgress',
        progress: {
          state: 'running',
          done: 0,
          total: 5,
          boostDone: 0,
          boostTotal: 0,
          working: '0000000000000000',
          queued: ['0000000000000001', '0000000000000002', '0000000000000003', '0000000000000004'],
          etaSeconds: 5,
        },
      }),
    );
    expect(useJobStore.getState().strip).toBe(true);
    const progress = useJobStore.getState().progress!;
    act(() => transport.emit({ type: 'jobProgress', progress: { ...progress, state } }));
    act(() => transport.emit({ type: 'gameTrend', reason: 'lineChanged', revision: 2, nodes: [] }));
    expect(useJobStore.getState().strip).toBe(true);
    act(() => useGameStore.getState().apply(makeSnapshot({ lineRevision: 2 })));
    act(() => transport.emit({ type: 'gameTrend', reason: 'reset', revision: 1, nodes: [] }));
    expect(useJobStore.getState().strip).toBe(true);
    act(() => transport.emit({ type: 'gameTrend', reason: 'reset', revision: 3, nodes: [] }));
    expect(useJobStore.getState().strip).toBe(false);
  },
);
