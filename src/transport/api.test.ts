import {
  cancelInstall,
  continueAnalysis,
  detectHardware,
  getAppInfo,
  getBackends,
  getEngineStatus,
  getInstalled,
  getInstallStatus,
  getLicences,
  getNetworks,
  getSettings,
  getTrend,
  getVersions,
  importNetwork,
  pauseAnalysis,
  removeUnused,
  restartEngine,
  resumeAnalysis,
  setSettings,
  startInstall,
  stopEngine,
} from './api';
import { createFakeTransport } from './fake';
import type { Response } from './generated/Response';
import type { UiSettings } from './generated/UiSettings';

it('rejects an unexpected response type', async () => {
  const t = createFakeTransport(() => ({ type: 'somethingElse' }) as unknown as Response);
  await expect(getAppInfo(t)).rejects.toMatchObject({ code: 'internal' });
});

it('sends each engine request and checks the response type', async () => {
  const sent: unknown[] = [];
  const t = createFakeTransport((request) => {
    sent.push(request);
    return request.type === 'engineStatus'
      ? {
          type: 'engineStatus',
          engine: { state: 'starting' },
          position: '4d325c64abd378a1',
          analysis: null,
          rejected: { position: '4d325c64abd378a1', message: 'illegal' },
          running: { backend: 'metal', networkName: 'kata1' },
        }
      : { type: 'ok' };
  });
  await expect(getEngineStatus(t)).resolves.toEqual({
    engine: { state: 'starting' },
    position: '4d325c64abd378a1',
    analysis: null,
    rejected: { position: '4d325c64abd378a1', message: 'illegal' },
    running: { backend: 'metal', networkName: 'kata1' },
  });
  await pauseAnalysis(t);
  await resumeAnalysis(t);
  await continueAnalysis(t);
  await restartEngine(t);
  expect(sent).toEqual([
    { type: 'engineStatus' },
    { type: 'analysisPause' },
    { type: 'analysisResume' },
    { type: 'analysisContinue' },
    { type: 'engineRestart' },
  ]);
});

it('rejects an unexpected engine response type', async () => {
  const t = createFakeTransport(() => ({ type: 'appInfo' }) as unknown as Response);
  await expect(getEngineStatus(t)).rejects.toMatchObject({ code: 'internal' });
  await expect(pauseAnalysis(t)).rejects.toMatchObject({ code: 'internal' });
});

describe('M5 helpers', () => {
  const settings: UiSettings = {
    language: 'en',
    theme: 'light',
    discLines: ['winrate', 'visits'],
    visitLimit: null,
    defaultRules: { kind: 'chinese' },
    showCoordinates: true,
    perspective: 'black',
  };
  const hardware = {
    os: { kind: 'macos', version: '27', arch: 'aarch64' },
    cpu: { name: 'Apple M5', cores: 10, threads: 10, avx2: false },
    memoryBytes: 1,
    gpus: [],
    problems: [],
  } as const;
  const job = {
    id: 1,
    engine: 'e',
    backend: 'metal',
    network: 'n',
    tasks: [],
    outcome: null,
    measures: false,
    benchmark: null,
  } as const;

  function answering(): { t: ReturnType<typeof createFakeTransport>; sent: unknown[] } {
    const sent: unknown[] = [];
    const t = createFakeTransport((request): Response => {
      sent.push(request);
      switch (request.type) {
        case 'settingsGet':
        case 'settingsSet':
          return { type: 'settings', settings: { ...settings } };
        case 'setupDetect':
          return { type: 'setupDetect', hardware: structuredClone(hardware) as never };
        case 'setupBackends':
          return {
            type: 'setupBackends',
            recommendation: {
              platform: 'macos-arm64',
              gpu: null,
              backends: [],
              default: null,
              fallbacks: [],
              notes: [],
              driver: null,
            },
          };
        case 'setupVersions':
          return { type: 'setupVersions', versions: [] };
        case 'setupNetworks':
          return {
            type: 'setupNetworks',
            networks: { networks: [], preselected: null, human: null },
          };
        case 'setupLicences':
          return { type: 'setupLicences', licences: [], accepted: [] };
        case 'setupStatus':
          return { type: 'setupStatus', job: { ...job, tasks: [] } };
        case 'setupImportNetwork':
          return { type: 'setupImportNetwork', network: null };
        case 'setupInstalled':
          return { type: 'setupInstalled', active: null, unusedBytes: 5 };
        case 'setupRemoveUnused':
          return { type: 'setupRemoved', freedBytes: 5 };
        default:
          return { type: 'ok' };
      }
    });
    return { t, sent };
  }

  it('sends each request and unwraps its answer', async () => {
    const { t, sent } = answering();
    await expect(getSettings(t)).resolves.toEqual(settings);
    await expect(
      setSettings(t, { ...settings, discLines: ['winrate', 'visits'] }),
    ).resolves.toEqual(settings);
    await expect(detectHardware(t, true)).resolves.toEqual(hardware);
    await expect(getBackends(t)).resolves.toMatchObject({ platform: 'macos-arm64' });
    await expect(getVersions(t, 'metal')).resolves.toEqual([]);
    await expect(getNetworks(t, 'e')).resolves.toEqual({
      networks: [],
      preselected: null,
      human: null,
    });
    await expect(getLicences(t, 'e')).resolves.toEqual({ licences: [], accepted: [] });
    await startInstall(t, 'e', 'n', ['h']);
    await startInstall(t, 'e', 'n', [], { benchmark: true });
    await cancelInstall(t);
    await expect(getInstallStatus(t)).resolves.toEqual(job);
    await expect(importNetwork(t)).resolves.toBeNull();
    await expect(getInstalled(t)).resolves.toEqual({ active: null, unusedBytes: 5 });
    await expect(removeUnused(t)).resolves.toBe(5);
    await stopEngine(t);
    expect(sent).toEqual([
      { type: 'settingsGet' },
      { type: 'settingsSet', settings: { ...settings, discLines: ['winrate', 'visits'] } },
      { type: 'setupDetect', refresh: true },
      { type: 'setupBackends' },
      { type: 'setupVersions', backend: 'metal' },
      { type: 'setupNetworks', engine: 'e' },
      { type: 'setupLicences', engine: 'e' },
      { type: 'setupInstall', engine: 'e', network: 'n', acceptLicences: ['h'], benchmark: false },
      { type: 'setupInstall', engine: 'e', network: 'n', acceptLicences: [], benchmark: true },
      { type: 'setupCancel' },
      { type: 'setupStatus' },
      { type: 'setupImportNetwork' },
      { type: 'setupInstalled' },
      { type: 'setupRemoveUnused' },
      { type: 'engineStop' },
    ]);
  });

  it('rejects a wrong response type', async () => {
    const t = createFakeTransport(() => ({ type: 'ok' }) as Response);
    for (const call of [
      () => getSettings(t),
      () => detectHardware(t, false),
      () => getBackends(t),
      () => getVersions(t, 'metal'),
      () => getNetworks(t, 'e'),
      () => getLicences(t, 'e'),
      () => getInstallStatus(t),
      () => importNetwork(t),
      () => getInstalled(t),
      () => removeUnused(t),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'internal' });
    }
  });
});

it('asks for the trend and unwraps its nodes', async () => {
  const nodes = [
    { moveNumber: 0, mover: null, move: null, stats: null },
    {
      moveNumber: 1,
      mover: 'black' as const,
      move: { type: 'pass' as const },
      stats: { winrate: 0.5, scoreLead: 0, visits: 60 },
    },
  ];
  const t = createFakeTransport((request) =>
    request.type === 'gameTrend' ? { type: 'trend', nodes } : { type: 'ok' },
  );
  await expect(getTrend(t)).resolves.toEqual(nodes);
  const wrong = createFakeTransport(() => ({ type: 'ok' }));
  await expect(getTrend(wrong)).rejects.toMatchObject({ code: 'internal' });
});
