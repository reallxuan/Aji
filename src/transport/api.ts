import type { ActiveSummary } from './generated/ActiveSummary';
import type { AnalysisUpdate } from './generated/AnalysisUpdate';
import type { AppInfo } from './generated/AppInfo';
import type { Backend } from './generated/Backend';
import type { BackendRecommendation } from './generated/BackendRecommendation';
import type { CacheScope } from './generated/CacheScope';
import type { CacheStats } from './generated/CacheStats';
import type { EngineVersionChoice } from './generated/EngineVersionChoice';
import type { HardwareReport } from './generated/HardwareReport';
import type { ImportedNetwork } from './generated/ImportedNetwork';
import type { JobOptions } from './generated/JobOptions';
import type { JobSnapshot } from './generated/JobSnapshot';
import type { LicenceInfo } from './generated/LicenceInfo';
import type { NetworkList } from './generated/NetworkList';
import type { EngineState } from './generated/EngineState';
import type { PositionKey } from './generated/PositionKey';
import type { AnalysisRules } from './generated/AnalysisRules';
import type { GameSnapshot } from './generated/GameSnapshot';
import type { GameWarning } from './generated/GameWarning';
import type { Move } from './generated/Move';
import type { NavTarget } from './generated/NavTarget';
import type { Preview } from './generated/Preview';
import type { Rejection } from './generated/Rejection';
import type { Request } from './generated/Request';
import type { Response } from './generated/Response';
import type { RunningEngine } from './generated/RunningEngine';
import type { ScoreMode } from './generated/ScoreMode';
import type { ScoreView } from './generated/ScoreView';
import type { TrendNode } from './generated/TrendNode';
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
  position: PositionKey | null;
  analysis: AnalysisUpdate | null;
  /** KataGo refused `position`. */
  rejected: Rejection | null;
  /** What the engine runs, for the engine card. */
  running: RunningEngine | null;
}

export async function getEngineStatus(transport: Transport): Promise<EngineStatus> {
  const response = await transport.request({ type: 'engineStatus' });
  if (response.type !== 'engineStatus') throw unexpected(response);
  const { engine, position, analysis, rejected, running } = response;
  return { engine, position, analysis, rejected, running };
}

async function expectOk(transport: Transport, request: Request): Promise<void> {
  const response = await transport.request(request);
  if (response.type !== 'ok') throw unexpected(response);
}

export const pauseAnalysis = (transport: Transport) =>
  expectOk(transport, { type: 'analysisPause' });
export const resumeAnalysis = (transport: Transport) =>
  expectOk(transport, { type: 'analysisResume' });
/** Searches the current position past its visit limit, by one more limit. */
export const continueAnalysis = (transport: Transport) =>
  expectOk(transport, { type: 'analysisContinue' });
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

/** Installs an engine set. The wizard installs without the benchmark; settings asks for it. */
export const startInstall = (
  transport: Transport,
  engine: string,
  network: string,
  acceptLicences: string[],
  { benchmark = false }: { benchmark?: boolean } = {},
) => expectOk(transport, { type: 'setupInstall', engine, network, acceptLicences, benchmark });

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

/** The game after a `game*` request, and what opening its file reported. */
export interface GameReply {
  snapshot: GameSnapshot;
  warnings: GameWarning[];
}

async function gameReply(transport: Transport, request: Request): Promise<GameReply> {
  const { snapshot, warnings } = await expectType(transport, request, 'game');
  return { snapshot, warnings };
}

export const newGame = (transport: Transport, size: number) =>
  gameReply(transport, { type: 'gameNew', size });

/** `bytes` is the file, base64-encoded. */
export const openGame = (transport: Transport, name: string, bytes: string) =>
  gameReply(transport, { type: 'gameOpen', name, bytes });

export const navigateGame = (transport: Transport, to: NavTarget) =>
  gameReply(transport, { type: 'gameNavigate', to });

/** `null` goes back to the file's reading. */
export const setGameRules = (transport: Transport, rules: AnalysisRules | null) =>
  gameReply(transport, { type: 'gameSetRules', rules });

export const getGameSnapshot = (transport: Transport) =>
  gameReply(transport, { type: 'gameSnapshot' });

export async function previewGame(transport: Transport, moves: Move[]): Promise<Preview> {
  return (await expectType(transport, { type: 'gamePreview', moves }, 'gamePreview')).preview;
}

export async function exportGame(transport: Transport): Promise<{ name: string; text: string }> {
  const { name, text } = await expectType(transport, { type: 'gameExport' }, 'gameExport');
  return { name, text };
}

/** One entry per main-line node, with the engine's cached result where it has one. */
export async function getTrend(
  transport: Transport,
): Promise<{ revision: number; nodes: TrendNode[] }> {
  const { revision, nodes } = await expectType(transport, { type: 'gameTrend' }, 'trend');
  return { revision, nodes };
}

export const startJob = (transport: Transport, options: JobOptions) =>
  expectOk(transport, { type: 'jobStart', options });

export const stopJob = (transport: Transport) => expectOk(transport, { type: 'jobStop' });

export const clearCache = (transport: Transport, scope: CacheScope) =>
  expectOk(transport, { type: 'cacheClear', scope });

export async function getCacheStats(transport: Transport): Promise<CacheStats> {
  const r = await expectType(transport, { type: 'cacheStats' }, 'cacheStats');
  return {
    usedBytes: r.usedBytes,
    capBytes: r.capBytes,
    persistent: r.persistent,
    reason: r.reason,
  };
}

/** KataGo's estimate, or the final count with `dead` removed, for the position on the board. */
export async function scoreGame(transport: Transport, mode: ScoreMode): Promise<ScoreView> {
  const r = await expectType(transport, { type: 'gameScore', mode }, 'score');
  const { black, white, komi, margin, owners, openByOwnership, suggestedDead } = r;
  return { black, white, komi, margin, owners, openByOwnership, suggestedDead };
}
