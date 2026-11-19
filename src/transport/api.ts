import type { AppInfo } from './generated/AppInfo';
import { TransportError, type Transport } from './transport';

export async function getAppInfo(transport: Transport): Promise<AppInfo> {
  const response = await transport.request({ type: 'appInfo' });
  if (response.type !== 'appInfo') {
    const type = (response as { type?: unknown }).type;
    throw new TransportError('internal', `unexpected response type ${String(type)}`);
  }
  return { version: response.version, os: response.os, arch: response.arch };
}
