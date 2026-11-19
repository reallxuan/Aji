import { invoke } from '@tauri-apps/api/core';
import type { Response } from './generated/Response';
import { toTransportError, type Transport } from './transport';

/** The local transport: every request goes through the single `rpc` Tauri command. */
export function createTauriTransport(): Transport {
  return {
    async request(request) {
      try {
        return await invoke<Response>('rpc', { request });
      } catch (error) {
        throw toTransportError(error);
      }
    },
  };
}
