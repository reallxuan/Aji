import type { AppEvent } from './generated/AppEvent';
import type { Request } from './generated/Request';
import type { Response } from './generated/Response';
import { toTransportError, type Transport } from './transport';

export type FakeTransport = Transport & { emit(event: AppEvent): void };

/** An in-memory transport for tests and for UI work without a backend. */
export function createFakeTransport(
  handler: (request: Request) => Response | Promise<Response>,
): FakeTransport {
  const listeners = new Set<(event: AppEvent) => void>();
  return {
    async request(request) {
      try {
        return await handler(request);
      } catch (error) {
        throw toTransportError(error);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
  };
}
