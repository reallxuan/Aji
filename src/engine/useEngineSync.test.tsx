import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createFakeTransport } from '../transport/fake';
import { TransportProvider } from '../transport/TransportProvider';
import { createEngineStore, EngineStoreProvider } from './engineStore';
import { useEngineSync } from './useEngineSync';

it('applies the status reply, then keeps following events', async () => {
  const store = createEngineStore();
  const transport = createFakeTransport(() => ({
    type: 'engineStatus',
    engine: { state: 'starting' },
    position: 'aaaaaaaaaaaaaaaa',
    analysis: null,
  }));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TransportProvider transport={transport}>
      <EngineStoreProvider store={store}>{children}</EngineStoreProvider>
    </TransportProvider>
  );
  renderHook(() => useEngineSync(), { wrapper });
  await act(async () => {});
  expect(store.getState().engine).toEqual({ state: 'starting' });
  act(() => transport.emit({ type: 'engineState', engine: { state: 'ready', version: '1' } }));
  expect(store.getState().engine).toEqual({ state: 'ready', version: '1' });
});
