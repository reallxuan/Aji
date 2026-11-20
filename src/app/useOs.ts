import { useEffect, useState } from 'react';
import { getAppInfo } from '../transport/api';
import type { OsKind } from '../transport/generated/OsKind';
import type { Transport } from '../transport/transport';
import { useTransport } from '../transport/TransportProvider';

const asked = new WeakMap<Transport, Promise<OsKind | null>>();

/** The system the app runs on, asked once per transport; `null` until it answers. */
export function useOs(): OsKind | null {
  const transport = useTransport();
  const [os, setOs] = useState<OsKind | null>(null);
  useEffect(() => {
    let active = true;
    let answer = asked.get(transport);
    if (!answer) {
      answer = getAppInfo(transport).then(
        (info) => info.os,
        () => null,
      );
      asked.set(transport, answer);
    }
    void answer.then((value) => {
      if (active) setOs(value);
    });
    return () => {
      active = false;
    };
  }, [transport]);
  return os;
}

/** A shortcut as the system writes it: `⇧⌘S` on macOS, `Ctrl+Shift+S` elsewhere. */
export function shortcut(os: OsKind | null, key: string, shift = false): string {
  if (os === 'macos') return `${shift ? '⇧' : ''}⌘${key}`;
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}
