import { createFakeTransport } from './fake';
import type { AppEvent } from './generated/AppEvent';

const event: AppEvent = { type: 'engineState', engine: { state: 'starting' } };

it('emit reaches every subscriber', () => {
  const transport = createFakeTransport(() => ({ type: 'ok' }));
  const a: AppEvent[] = [];
  const b: AppEvent[] = [];
  transport.subscribe((e) => a.push(e));
  transport.subscribe((e) => b.push(e));
  transport.emit(event);
  expect(a).toEqual([event]);
  expect(b).toEqual([event]);
});

it('unsubscribe stops delivery', () => {
  const transport = createFakeTransport(() => ({ type: 'ok' }));
  const received: AppEvent[] = [];
  const unsubscribe = transport.subscribe((e) => received.push(e));
  unsubscribe();
  transport.emit(event);
  expect(received).toEqual([]);
});
