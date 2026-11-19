import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppEvent } from './generated/AppEvent';
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
    subscribe(listener) {
      let active = true;
      let unlisten: UnlistenFn | null = null;
      void listen<AppEvent>('aji://event', (event) => {
        if (active) listener(event.payload);
      }).then((fn) => {
        // An unsubscribe that ran before listen resolved still has to unlisten.
        if (active) unlisten = fn;
        else fn();
      });
      return () => {
        active = false;
        unlisten?.();
        unlisten = null;
      };
    },
  };
}
