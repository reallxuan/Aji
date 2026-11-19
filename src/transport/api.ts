import type { AppInfo } from './generated/AppInfo';
import type { EngineState } from './generated/EngineState';
import type { Request } from './generated/Request';
import { TransportError, type Transport } from './transport';

export async function getAppInfo(transport: Transport): Promise<AppInfo> {
  const response = await transport.request({ type: 'appInfo' });
  if (response.type !== 'appInfo') {
    const type = (response as { type?: unknown }).type;
    throw new TransportError('internal', `unexpected response type ${String(type)}`);
  }
  return { version: response.version, os: response.os, arch: response.arch };
}

function unexpected(response: { type?: unknown }): TransportError {
  return new TransportError('internal', `unexpected response type ${String(response.type)}`);
}

export async function getEngineStatus(transport: Transport): Promise<EngineState> {
  const response = await transport.request({ type: 'engineStatus' });
  if (response.type !== 'engineStatus') throw unexpected(response);
  return response.engine;
}

async function expectOk(transport: Transport, request: Request): Promise<void> {
  const response = await transport.request(request);
  if (response.type !== 'ok') throw unexpected(response);
}

export const pauseAnalysis = (transport: Transport) =>
  expectOk(transport, { type: 'analysisPause' });
export const resumeAnalysis = (transport: Transport) =>
  expectOk(transport, { type: 'analysisResume' });
export const restartEngine = (transport: Transport) =>
  expectOk(transport, { type: 'engineRestart' });
