import type { ActiveSummary } from './generated/ActiveSummary';
import type { AnalysisUpdate } from './generated/AnalysisUpdate';
import type { AppInfo } from './generated/AppInfo';
import type { Backend } from './generated/Backend';
import type { BackendRecommendation } from './generated/BackendRecommendation';
import type { EngineVersionChoice } from './generated/EngineVersionChoice';
import type { HardwareReport } from './generated/HardwareReport';
import type { ImportedNetwork } from './generated/ImportedNetwork';
import type { JobSnapshot } from './generated/JobSnapshot';
import type { LicenceInfo } from './generated/LicenceInfo';
import type { NetworkList } from './generated/NetworkList';
import type { EngineState } from './generated/EngineState';
import type { PositionKey } from './generated/PositionKey';
import type { Request } from './generated/Request';
import type { Response } from './generated/Response';
import type { UiSettings } from './generated/UiSettings';
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

export interface EngineStatus {
  engine: EngineState;
  position: PositionKey;
  analysis: AnalysisUpdate | null;
}

export async function getEngineStatus(transport: Transport): Promise<EngineStatus> {
  const response = await transport.request({ type: 'engineStatus' });
  if (response.type !== 'engineStatus') throw unexpected(response);
  return { engine: response.engine, position: response.position, analysis: response.analysis };
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
export const stopEngine = (transport: Transport) => expectOk(transport, { type: 'engineStop' });

/** Sends `request` and returns the response, which must have type `type`. */
async function expectType<T extends Response['type']>(
  transport: Transport,
  request: Request,
  type: T,
): Promise<Extract<Response, { type: T }>> {
  const response = await transport.request(request);
  if (response.type !== type) throw unexpected(response);
  return response as Extract<Response, { type: T }>;
}

export async function getSettings(transport: Transport): Promise<UiSettings> {
  return (await expectType(transport, { type: 'settingsGet' }, 'settings')).settings;
}

export async function setSettings(transport: Transport, settings: UiSettings): Promise<UiSettings> {
  return (await expectType(transport, { type: 'settingsSet', settings }, 'settings')).settings;
}

export async function detectHardware(
  transport: Transport,
  refresh: boolean,
): Promise<HardwareReport> {
  return (await expectType(transport, { type: 'setupDetect', refresh }, 'setupDetect')).hardware;
}

export async function getBackends(transport: Transport): Promise<BackendRecommendation> {
  return (await expectType(transport, { type: 'setupBackends' }, 'setupBackends')).recommendation;
}

export async function getVersions(
  transport: Transport,
  backend: Backend,
): Promise<EngineVersionChoice[]> {
  return (await expectType(transport, { type: 'setupVersions', backend }, 'setupVersions'))
    .versions;
}

export async function getNetworks(transport: Transport, engine: string): Promise<NetworkList> {
  return (await expectType(transport, { type: 'setupNetworks', engine }, 'setupNetworks')).networks;
}

export async function getLicences(
  transport: Transport,
  engine: string,
): Promise<{ licences: LicenceInfo[]; accepted: string[] }> {
  const { licences, accepted } = await expectType(
    transport,
    { type: 'setupLicences', engine },
    'setupLicences',
  );
  return { licences, accepted };
}

export const startInstall = (
  transport: Transport,
  engine: string,
  network: string,
  acceptLicences: string[],
) => expectOk(transport, { type: 'setupInstall', engine, network, acceptLicences });

export const cancelInstall = (transport: Transport) => expectOk(transport, { type: 'setupCancel' });

export async function getInstallStatus(transport: Transport): Promise<JobSnapshot | null> {
  return (await expectType(transport, { type: 'setupStatus' }, 'setupStatus')).job;
}

/** Opens the native file dialog; `null` when the user cancels it. */
export async function importNetwork(transport: Transport): Promise<ImportedNetwork | null> {
  return (await expectType(transport, { type: 'setupImportNetwork' }, 'setupImportNetwork'))
    .network;
}

export async function getInstalled(
  transport: Transport,
): Promise<{ active: ActiveSummary | null; unusedBytes: number }> {
  const { active, unusedBytes } = await expectType(
    transport,
    { type: 'setupInstalled' },
    'setupInstalled',
  );
  return { active, unusedBytes };
}

/** Deletes what the active engine does not use; the bytes freed. */
export async function removeUnused(transport: Transport): Promise<number> {
  return (await expectType(transport, { type: 'setupRemoveUnused' }, 'setupRemoved')).freedBytes;
}
