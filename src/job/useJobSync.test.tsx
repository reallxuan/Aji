import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { createFakeTransport } from '../transport/fake';
import { TransportProvider } from '../transport/TransportProvider';
import { resetJobStore, useJobStore } from './jobStore';
import { useJobSync } from './useJobSync';

afterEach(() => resetJobStore());

it('a whole-trend push hides the strip: another game, or every result gone', () => {
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
        working: 0,
        queued: [1, 2, 3, 4],
        etaSeconds: 5,
      },
    }),
  );
  expect(useJobStore.getState().strip).toBe(true);
  act(() => transport.emit({ type: 'gameTrend', revision: 2, nodes: [] }));
  expect(useJobStore.getState().strip).toBe(false);
});
