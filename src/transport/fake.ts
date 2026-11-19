import type { Request } from './generated/Request';
import type { Response } from './generated/Response';
import { toTransportError, type Transport } from './transport';

/** An in-memory transport for tests and for UI work without a backend. */
export function createFakeTransport(
  handler: (request: Request) => Response | Promise<Response>,
): Transport {
  return {
    async request(request) {
      try {
        return await handler(request);
      } catch (error) {
        throw toTransportError(error);
      }
    },
  };
}
