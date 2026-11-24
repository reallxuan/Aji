// Development-only setup scenarios: scripted engine sides for the panels a Mac cannot reach by
// itself (CUDA, old drivers, NVIDIA licences, failures). main.tsx loads this module only in a
// development build with `?scenario=<name>`, so a production build leaves it out.
//
// Ids, sizes, dates and driver versions are copied from the bundled manifest
// (crates/aji-manager/manifest/manifest.json).

import { createFakeTransport, type FakeTransport } from '../transport/fake';
import { finalCount } from './finalCount';
import { createFakeGame, fakeAnalysis } from './fakeGame';
import { fakeResult, playFakeJob, type FakeJob } from './fakeJob';
import type { ActiveSummary } from '../transport/generated/ActiveSummary';
import type { Backend } from '../transport/generated/Backend';
import type { BackendRecommendation } from '../transport/generated/BackendRecommendation';
import type { EngineState } from '../transport/generated/EngineState';
import type { EngineVersionChoice } from '../transport/generated/EngineVersionChoice';
import type { FailureCode } from '../transport/generated/FailureCode';
import type { FallbackOffer } from '../transport/generated/FallbackOffer';
import type { HardwareReport } from '../transport/generated/HardwareReport';
import type { JobOutcome } from '../transport/generated/JobOutcome';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import type { LicenceInfo } from '../transport/generated/LicenceInfo';
import type { NetworkChoice } from '../transport/generated/NetworkChoice';
import type { NetworkList } from '../transport/generated/NetworkList';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import type { TaskKind } from '../transport/generated/TaskKind';
import type { TrendNode } from '../transport/generated/TrendNode';
import type { TrendStats } from '../transport/generated/TrendStats';
import type { UiSettings } from '../transport/generated/UiSettings';
import { TransportError } from '../transport/transport';

export const SCENARIOS = [
  'pc-cuda',
  'pc-old-driver',
  'cuda-licence',
  'a1-driver',
  'a2-gpu-error',
  'b-download-failed',
  'd-crashed',
  'no-engine',
  'mac',
  'game',
  'analysing',
  'job-running',
  'job-done',
] as const;

export type ScenarioName = (typeof SCENARIOS)[number];

const GiB = 1024 ** 3;

// --- Machines ---------------------------------------------------------------------------------

const rtx5070 = (driverVersion: string | null) => ({
  vendor: 'nvidia' as const,
  name: 'NVIDIA GeForce RTX 5070',
  memoryBytes: 12 * GiB,
  driverVersion,
  pciDeviceId: 0x2f04,
  appleGpuCores: null,
  computeCapability: '12.0',
  software: false,
});

const pc = (driverVersion: string | null): HardwareReport => ({
  os: { kind: 'windows', version: '11', arch: 'x86_64' },
  cpu: { name: 'AMD Ryzen 7 7700', cores: 8, threads: 16, avx2: true },
  memoryBytes: 32 * GiB,
  gpus: [rtx5070(driverVersion)],
  problems: driverVersion === null ? ['nvidiaSmi'] : [],
});

const mac: HardwareReport = {
  os: { kind: 'macos', version: '26.1', arch: 'aarch64' },
  cpu: { name: 'Apple M4 Pro', cores: 12, threads: 12, avx2: false },
  memoryBytes: 48 * GiB,
  gpus: [
    {
      vendor: 'apple',
      name: 'Apple M4 Pro',
      memoryBytes: null,
      driverVersion: null,
      pciDeviceId: null,
      appleGpuCores: 20,
      computeCapability: null,
      software: false,
    },
  ],
  problems: [],
};

// --- Recommendations --------------------------------------------------------------------------

const pcRecommendation = (hardware: HardwareReport): BackendRecommendation => ({
  platform: 'windows-x64',
  gpu: hardware.gpus[0],
  backends: [
    { backend: 'cuda', tags: ['fastest'] },
    { backend: 'directml', tags: ['noRuntimeDownload'] },
    { backend: 'opencl', tags: ['mostCompatible', 'slowest'] },
    { backend: 'eigenavx2', tags: ['cpuOnly'] },
  ],
  default: 'cuda',
  fallbacks: ['directml', 'opencl', 'eigenavx2'],
  notes: [],
  driver: null,
});

/** CUDA 13.2 needs driver 580.00 (the runtime's minDriver); 566.36 is below it. */
const oldDriverRecommendation = (hardware: HardwareReport): BackendRecommendation => ({
  ...pcRecommendation(hardware),
  backends: pcRecommendation(hardware).backends.filter((b) => b.backend !== 'cuda'),
  default: 'directml',
  fallbacks: ['opencl', 'eigenavx2'],
  notes: ['driverTooOldForCuda'],
  driver: { current: '566.36', required: '580.00' },
});

const macRecommendation: BackendRecommendation = {
  platform: 'macos-arm64',
  gpu: mac.gpus[0],
  backends: [{ backend: 'metal', tags: ['fastest'] }],
  default: 'metal',
  fallbacks: [],
  notes: [],
  driver: null,
};

// --- Catalogue --------------------------------------------------------------------------------

const CUDA_RUNTIME = 1_950_349_675;

const VERSIONS: Partial<Record<Backend, EngineVersionChoice[]>> = {
  cuda: [
    {
      engine: 'katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64',
      version: '1.18.2',
      released: '2026-08-30',
      downloadBytes: 9_825_374,
      runtimeBytes: CUDA_RUNTIME,
      latest: true,
      installed: false,
    },
    {
      engine: 'katago-v1.18.1-cuda13.2-cudnn9.24.0-windows-x64',
      version: '1.18.1',
      released: '2026-08-24',
      downloadBytes: 9_784_089,
      runtimeBytes: CUDA_RUNTIME,
      latest: false,
      installed: false,
    },
  ],
  directml: [
    {
      engine: 'katago-v1.18.1-onnx1.24.4-directml-windows-x64',
      version: '1.18.1',
      released: '2026-08-24',
      downloadBytes: 23_584_379,
      runtimeBytes: null,
      latest: true,
      installed: false,
    },
  ],
  opencl: [
    {
      engine: 'katago-v1.18.1-opencl-windows-x64',
      version: '1.18.1',
      released: '2026-08-24',
      downloadBytes: 6_004_137,
      runtimeBytes: null,
      latest: true,
      installed: false,
    },
  ],
  eigenavx2: [
    {
      engine: 'katago-v1.18.1-eigenavx2-windows-x64',
      version: '1.18.1',
      released: '2026-08-24',
      downloadBytes: 5_899_607,
      runtimeBytes: null,
      latest: true,
      installed: false,
    },
  ],
  metal: [
    {
      engine: 'katago-v1.18.2-metal-macos-arm64',
      version: '1.18.2',
      released: '2026-11-19',
      downloadBytes: 3_934_477,
      runtimeBytes: null,
      latest: true,
      installed: false,
    },
  ],
};

const network = (id: string, elo: number | null, uploaded: string, sizeBytes: number) => ({
  network: id,
  family: id.replace(/^kata1-/, '').split('-s')[0],
  elo,
  uploaded,
  sizeBytes,
  installed: false,
});

const NETWORKS: NetworkList = {
  networks: [
    network('kata1-tf3-b11c768-s12382M-d6533M', 14638.2, '2026-11-01', 262_041_254),
    network('kata1-zhizi-b40c768nbt-s11272M-d5935M', 14523.8, '2026-06-06', 863_210_287),
    network('kata1-tf3-b10c512-s3203M-d5937M', 14175.2, '2026-08-25', 94_281_753),
    network('kata1-zhizi-b28c512nbt-muonfd2', 14164.6, '2026-03-22', 271_447_864),
    network('kata1-b28c512nbt-s13255194368-d5935380940', 14111.4, '2026-06-07', 271_440_852),
    network('kata1-tf2-b10c384-s2941M-d5872M', 13715.8, '2026-08-25', 38_245_507),
    network('kata1-b18c384nbt-s9996604416-d4316597426', 13629.1, '2024-05-26', 97_898_094),
    network('kata1-b60c320-s9356080896-d3824355768', 13557.6, '2023-11-17', 403_507_095),
  ],
  preselected: 'kata1-tf3-b11c768-s12382M-d6533M',
  human: network('b18c384nbt-humanv0', null, '2025-04-22', 99_066_230),
};

const CUDA_LICENCES: LicenceInfo[] = [
  {
    name: 'NVIDIA CUDA Toolkit EULA',
    url: 'https://docs.nvidia.com/cuda/eula/index.html',
    textSha256: '1'.repeat(64),
    components: [
      { name: 'cudart', version: '13.2', bytes: 3_412_018 },
      { name: 'cublas', version: '13.2', bytes: 1_041_550_301 },
    ],
  },
  {
    name: 'NVIDIA cuDNN Software License Agreement',
    url: 'https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html',
    textSha256: '2'.repeat(64),
    components: [{ name: 'cudnn', version: '9.24.0', bytes: 905_387_356 }],
  },
];

const directmlOffer: FallbackOffer = {
  backend: 'directml',
  engine: 'katago-v1.18.1-onnx1.24.4-directml-windows-x64',
  downloadBytes: 23_584_379,
  runtimeBytes: null,
};

// --- Scripts ----------------------------------------------------------------------------------

type Failure = { task: TaskKind; outcome: Extract<JobOutcome, { outcome: 'failed' }> };

const failed = (
  failure: FailureCode,
  stderrTail: string[],
  offer: FallbackOffer | null,
  driver: { current: string; required: string } | null = null,
) => ({ outcome: 'failed' as const, failure, stderrTail, offer, driver });

interface Script {
  hardware(refreshed: boolean): HardwareReport;
  recommendation(hardware: HardwareReport, refreshed: boolean): BackendRecommendation;
  /** Licence hashes accepted before the scenario starts. */
  accepted: string[];
  engine: EngineState;
  active: ActiveSummary | null;
  /** How installing `engine` fails, or `null` when it installs. */
  failure(engine: string): Failure | null;
}

const isCuda = (engine: string) => engine.includes('-cuda');

const pcCuda: Script = {
  hardware: () => pc('581.08'),
  recommendation: (hardware) => pcRecommendation(hardware),
  accepted: CUDA_LICENCES.map((l) => l.textSha256),
  engine: { state: 'notConfigured' },
  active: null,
  failure: () => null,
};

// A Mac with the engine running, for the game header, navigation and file commands. The open
// dialog, drops and recent list offer the sample files in `fakeGame.ts`.
const gameScript: Script = {
  hardware: () => mac,
  recommendation: () => macRecommendation,
  accepted: [],
  engine: { state: 'ready', version: '1.18.2', limitReached: false },
  active: {
    engine: 'katago-v1.18.2-metal-macos-arm64',
    version: '1.18.2',
    backend: 'metal',
    network: 'kata1-tf3-b11c768-s12382M-d6533M',
    networkName: 'kata1-tf3-b11c768-s12382M-d6533M',
    threads: 12,
    visitsPerSecond: null,
  },
  failure: () => null,
};

const SCRIPTS: Record<ScenarioName, Script> = {
  'pc-cuda': pcCuda,
  'pc-old-driver': {
    ...pcCuda,
    // The user updates the driver, then presses "detect again".
    hardware: (refreshed) => pc(refreshed ? '581.08' : '566.36'),
    recommendation: (hardware, refreshed) =>
      refreshed ? pcRecommendation(hardware) : oldDriverRecommendation(hardware),
  },
  'cuda-licence': { ...pcCuda, accepted: [] },
  'a1-driver': {
    ...pcCuda,
    // Detection could not read the driver, so CUDA was offered; KataGo then refuses it.
    hardware: () => pc(null),
    failure: (engine) =>
      isCuda(engine)
        ? {
            // The wizard installs without the benchmark, so KataGo first runs for the test query.
            task: 'testQuery',
            outcome: failed(
              'gpuDriverTooOld',
              ['CUDA Error: CUDA driver version is insufficient for CUDA runtime version'],
              directmlOffer,
              { current: '566.36', required: '580.00' },
            ),
          }
        : null,
  },
  'a2-gpu-error': {
    ...pcCuda,
    failure: (engine) =>
      isCuda(engine)
        ? {
            // The wizard installs without the benchmark, so KataGo first runs for the test query.
            task: 'testQuery',
            outcome: failed(
              'gpuError',
              [
                'CUDA Error: an illegal memory access was encountered',
                'file: cudahelpers.cu line: 54',
              ],
              directmlOffer,
            ),
          }
        : null,
  },
  'b-download-failed': {
    ...pcCuda,
    failure: () => ({ task: 'network', outcome: failed('downloadFailed', [], null) }),
  },
  'd-crashed': {
    ...pcCuda,
    engine: {
      state: 'crashed',
      reason: 'exited',
      exit: { code: 1, signal: null },
      stderrTail: [
        'Loading model and initializing benchmark...',
        'CUDA Error: no CUDA-capable device is detected',
        'file: cudahelpers.cu line: 54',
      ],
    },
    active: {
      engine: 'katago-v1.18.2-cuda13.2-cudnn9.24.0-windows-x64',
      version: '1.18.2',
      backend: 'cuda',
      network: 'kata1-tf3-b11c768-s12382M-d6533M',
      networkName: 'kata1-tf3-b11c768-s12382M-d6533M',
      threads: 16,
      visitsPerSecond: null,
    },
  },
  'no-engine': pcCuda,
  mac: {
    hardware: () => mac,
    recommendation: () => macRecommendation,
    accepted: [],
    engine: { state: 'notConfigured' },
    active: null,
    failure: () => null,
  },
  game: gameScript,
  // The game scenario with KataGo analysing: a fake feed of candidates every 100 ms, for the
  // discs, the table, the trend graph and hovering. It honours the visit limit, Continue, Pause
  // and Resume, and a revisited position searches again, catching up on what is cached.
  analysing: { ...gameScript, engine: { state: 'analysing', version: '1.18.2' } },
  // A sample game open and a whole-game job running over it: the strip, the status and the
  // trend filling in, then the boost pass and done.
  'job-running': { ...gameScript, engine: { state: 'analysing', version: '1.18.2' } },
  // The same game with the job just done: every node has a result and a loss.
  'job-done': gameScript,
};

/** How often the analysing scenario reports, and how many visits each report adds. */
const FEED_MS = 100;
const FEED_VISITS = 50;

// --- The scripted engine side -----------------------------------------------------------------

export type ScenarioTransport = FakeTransport & {
  /** Request types the scenario could not answer; a test expects none. */
  unhandled: string[];
};

/**
 * A transport that plays scenario `name`, or `null` for an unknown name. Install progress is
 * emitted every `tick` milliseconds.
 */
export function scenarioTransport(
  name: string,
  { tick = 350 }: { tick?: number } = {},
): ScenarioTransport | null {
  if (!(SCENARIOS as readonly string[]).includes(name)) return null;
  const script = SCRIPTS[name as ScenarioName];

  let refreshed = false;
  let hardware = script.hardware(false);
  let engine: EngineState = script.engine;
  let active = script.active;
  let settings: UiSettings = {
    language: 'system',
    theme: 'system',
    discLines: ['winrate', 'scoreLead'],
    visitLimit: null,
    defaultRules: { kind: 'chinese' },
    showCoordinates: true,
    perspective: 'black',
    showNextMove: true,
    analyseOnOpen: false,
    cacheCapMb: 1024,
    saveAnalysis: false,
    jobOptions: {
      scope: 'line',
      range: { kind: 'whole' },
      side: 'both',
      visits: 500,
      boost: { on: true, threshold: 10, visits: 3000 },
    },
  };
  const accepted = new Set(script.accepted);
  const installed = new Set<string>();
  let job: JobSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextJob = 1;
  const unhandled: string[] = [];

  const transport = createFakeTransport((request) => handle(request)) as ScenarioTransport;
  transport.unhandled = unhandled;
  const game = createFakeGame((event) => {
    if (event.type === 'gameTrend') {
      if (event.reason === 'reset') {
        stopFakeJob();
        results.clear();
        feed?.clear();
      }
      transport.emit({ ...event, nodes: withResults(event.nodes) });
    } else {
      transport.emit(event);
      if (event.type === 'gameSnapshot') feed?.updateAvailability(event.snapshot);
    }
  });

  const results = new Map<string, TrendStats>();
  let fakeJob: FakeJob | null = null;
  let jobSearching = false;
  const trendOf = () => {
    const reply = game({ type: 'gameTrend' });
    if (reply?.type !== 'trend') throw new Error('the fake game has no trend');
    return reply;
  };
  function withResults(nodes: TrendNode[]): TrendNode[] {
    let parent: TrendStats | null = null;
    return nodes.map((node) => {
      const stats = node.key ? (results.get(node.key) ?? null) : null;
      const sign = node.mover === 'black' ? 1 : -1;
      const loss =
        stats && parent && node.mover
          ? {
              winrate: sign * (parent.winrate - stats.winrate) * 100,
              score: sign * (parent.scoreLead - stats.scoreLead),
            }
          : null;
      parent = stats;
      return { ...node, stats, loss };
    });
  }
  const analysedTrend = () => {
    const trend = trendOf();
    return { ...trend, nodes: withResults(trend.nodes) };
  };
  const startFakeJob = (options: UiSettings['jobOptions']) => {
    fakeJob?.stop();
    const main = game.mainLine();
    const selected = options.scope === 'line' ? new Set(trendOf().nodes.map((n) => n.node)) : null;
    const eligible = selected ? main.filter((n) => selected.has(n.node)) : main;
    fakeJob = playFakeJob({
      nodes: eligible,
      options,
      stepMs: Math.max(10, tick / 5),
      emit: (event) => {
        transport.emit(event);
        if (event.type === 'jobProgress') {
          const searching =
            event.progress.state === 'running' || event.progress.state === 'boosting';
          if (jobSearching !== searching) {
            jobSearching = searching;
            feed?.updateAvailability();
          }
        }
      },
      onResult: (i, result) => {
        const key = eligible[i].key;
        if (!key) return;
        results.set(key, result);
        const { revision, nodes } = analysedTrend();
        const patches = nodes.flatMap((node, lineIndex) =>
          node.key === key || nodes[lineIndex - 1]?.key === key
            ? [{ lineIndex, stats: node.stats, loss: node.loss }]
            : [],
        );
        if (patches.length) transport.emit({ type: 'trendNodes', revision, nodes: patches });
      },
    });
  };
  const stopFakeJob = () => {
    fakeJob?.stop();
    fakeJob = null;
  };
  const feed = name === 'analysing' ? startFeed() : null;
  if (name === 'job-running' || name === 'job-done') {
    game({ type: 'gameOpen', name: 'samsung-30-final-2.sgf', bytes: '', atEnd: false });
    if (name === 'job-running') {
      setTimeout(() => startFakeJob(settings.jobOptions), tick);
    } else {
      const nodes = game.mainLine();
      const count = nodes.length;
      nodes.forEach((node, i) => {
        if (node.key) results.set(node.key, fakeResult(i, 500));
      });
      const done = {
        state: 'done' as const,
        done: count,
        total: count,
        boostDone: 6,
        boostTotal: 6,
        working: null,
        queued: [],
        etaSeconds: null,
      };
      setTimeout(() => transport.emit({ type: 'jobProgress', progress: done }), tick);
    }
  }

  const setEngine = (state: EngineState) => {
    engine = state;
    transport.emit({ type: 'engineState', engine });
  };
  const startEngine = () => {
    setEngine({ state: 'starting' });
    setTimeout(
      () =>
        setEngine({ state: 'ready', version: active?.version ?? '1.18.2', limitReached: false }),
      tick * 2,
    );
  };

  /** The analysing scenario's engine: one search at a time, on the position on the board. */
  function startFeed() {
    const version = '1.18.2';
    // The deepest search per position, and targets raised by Continue.
    const reached = new Map<string, number>();
    const targets = new Map<string, number>();
    let key: string | null = null;
    let visits = 0;
    let previous = 0;
    let paused = false;
    const target = (k: string) => Math.max(settings.visitLimit ?? Infinity, targets.get(k) ?? 0);
    const current = () => {
      const reply = game({ type: 'gameSnapshot' });
      return reply?.type === 'game' ? reply.snapshot : null;
    };
    // Off the main line (or on an illegal node), only a running job can keep the engine busy.
    function updateAvailability(snapshot = current()): boolean {
      if (snapshot?.positionKey && game.onMainLine()) return true;
      key = null;
      if (paused) return false;
      if (jobSearching) {
        if (engine.state !== 'analysing') setEngine({ state: 'analysing', version });
      } else if (
        engine.state === 'analysing' ||
        (engine.state === 'ready' && engine.limitReached) ||
        engine.state === 'paused'
      ) {
        setEngine({ state: 'ready', version, limitReached: false });
      }
      return false;
    }
    const atLimit = () => {
      if (engine.state !== 'ready' || !engine.limitReached)
        setEngine({ state: 'ready', version, limitReached: true });
    };
    setInterval(() => {
      const snapshot = current();
      if (paused || !snapshot?.positionKey || !updateAvailability(snapshot)) return;
      const k = snapshot.positionKey;
      if (k !== key) {
        key = k;
        previous = reached.get(k) ?? 0;
        if (previous >= target(k)) {
          // A position searched to its limit: the cached analysis, and no new search.
          visits = previous;
          transport.emit({ type: 'analysisUpdate', analysis: fakeAnalysis(snapshot, previous) });
          atLimit();
          return;
        }
        visits = 0;
      }
      if (visits >= target(k)) {
        // A limit lowered below the search's depth stops it at once, as in the engine.
        atLimit();
        return;
      }
      visits = Math.min(target(k), visits + FEED_VISITS);
      reached.set(k, Math.max(reached.get(k) ?? 0, visits));
      if (engine.state !== 'analysing') setEngine({ state: 'analysing', version });
      transport.emit({
        type: 'analysisUpdate',
        analysis: fakeAnalysis(snapshot, visits, previous),
      });
      if (visits >= target(k)) atLimit();
    }, FEED_MS);
    return {
      updateAvailability,
      clear(position?: string) {
        if (position === undefined) {
          reached.clear();
          targets.clear();
        } else {
          reached.delete(position);
          targets.delete(position);
        }
        if (position === undefined || position === key) key = null;
      },
      pause() {
        paused = true;
        setEngine({ state: 'paused', version });
      },
      resume() {
        paused = false;
        if (updateAvailability()) setEngine({ state: 'analysing', version });
      },
      continue() {
        if (key === null || settings.visitLimit === null) return;
        // As the engine does: a new search, aiming one limit past the cached depth.
        previous = reached.get(key) ?? 0;
        targets.set(key, previous + settings.visitLimit);
        visits = 0;
        setEngine({ state: 'analysing', version });
      },
    };
  }

  const publish = () => {
    if (job) transport.emit({ type: 'setupProgress', job: structuredClone(job) });
  };

  const backendOf = (id: string) =>
    (Object.entries(VERSIONS) as Array<[Backend, EngineVersionChoice[]]>).find(([, list]) =>
      list.some((v) => v.engine === id),
    );

  function runJob(engineId: string, networkId: string, benchmark: boolean) {
    const [backend, list] = backendOf(engineId)!;
    const version = list.find((v) => v.engine === engineId)!;
    const kinds: TaskKind[] = ['engine'];
    if (version.runtimeBytes) kinds.push('runtime');
    kinds.push('network');
    if (benchmark) kinds.push('benchmark');
    kinds.push('testQuery');
    const failure = script.failure(engineId);
    job = {
      id: nextJob++,
      engine: engineId,
      backend,
      network: networkId,
      tasks: kinds.map((task) => ({ task, state: { state: 'waiting' } })),
      outcome: null,
      measures: benchmark,
      benchmark: null,
    };
    publish();

    const steps: Array<() => void> = [];
    for (const [index, task] of kinds.entries()) {
      const key =
        task === 'engine' ? engineId : task === 'network' ? networkId : `${engineId}:${task}`;
      const row = () => job!.tasks[index];
      if ((task === 'engine' || task === 'network' || task === 'runtime') && installed.has(key)) {
        steps.push(() => (row().state = { state: 'reused' }));
        continue;
      }
      if (task === 'benchmark') {
        // As the real benchmark reports it: starting, then each thread count, 5 positions each.
        const speeds = [
          { threads: 8, visitsPerSecond: 412.6 },
          { threads: 16, visitsPerSecond: 598.1 },
          { threads: 32, visitsPerSecond: 611.9 },
        ];
        steps.push(() => {
          row().state = { state: 'running', done: 0, total: 15 };
          job!.benchmark = { testing: null, positionsDone: 0, tested: [] };
        });
        for (const [n, speed] of speeds.entries()) {
          for (const positionsDone of [0, 3]) {
            steps.push(() => {
              row().state = { state: 'running', done: n * 5 + positionsDone, total: 15 };
              job!.benchmark = {
                testing: speed.threads,
                positionsDone,
                tested: speeds.slice(0, n),
              };
            });
          }
        }
      } else {
        // Downloads count bytes, so the line under the bar shows sizes and a speed.
        const total = 240 * 1024 * 1024;
        for (const share of [0, 0.25, 0.5, 0.75]) {
          steps.push(() => (row().state = { state: 'running', done: total * share, total }));
        }
      }
      if (failure?.task === task) {
        steps.push(() => {
          row().state = { state: 'failed', failure: failure.outcome.failure };
          job!.outcome = failure.outcome;
        });
        break;
      }
      steps.push(() => {
        row().state = { state: 'done' };
        installed.add(key);
      });
    }
    if (!failure) {
      steps.push(() => {
        job!.outcome = { outcome: 'installed' };
        active = {
          engine: engineId,
          version: version.version,
          backend,
          network: networkId,
          networkName: networkId,
          threads: hardware.cpu.threads,
          // A measured count names its speed, as the backend reads it from the benchmark.
          visitsPerSecond: benchmark ? 180 : null,
        };
      });
    }

    const step = () => {
      const next = steps.shift();
      if (!next || !job) return;
      next();
      publish();
      if (job.outcome?.outcome === 'installed') {
        startEngine();
      } else if (job.outcome === null) {
        timer = setTimeout(step, tick);
      }
    };
    timer = setTimeout(step, tick);
  }

  function handle(request: Request): Response {
    switch (request.type) {
      case 'appInfo':
        return {
          type: 'appInfo',
          version: '0.1.0',
          os: hardware.os.kind,
          arch: hardware.os.arch,
        };
      case 'engineStatus':
        return {
          type: 'engineStatus',
          engine,
          position: '0000000000000000',
          analysis: null,
          rejected: null,
          running: active ? { backend: active.backend, networkName: active.networkName } : null,
        };
      case 'engineRestart':
        if (!active) throw new TransportError('engineNotConfigured', 'no engine');
        startEngine();
        return { type: 'ok' };
      case 'engineStop':
        setEngine({ state: 'stopped' });
        return { type: 'ok' };
      case 'analysisPause':
        feed?.pause();
        return { type: 'ok' };
      case 'analysisResume':
        feed?.resume();
        return { type: 'ok' };
      case 'analysisContinue':
        feed?.continue();
        return { type: 'ok' };
      case 'setupSetDownloadSource':
        return { type: 'ok' };
      case 'setupDetect':
        if (request.refresh) refreshed = true;
        hardware = script.hardware(refreshed);
        return { type: 'setupDetect', hardware };
      case 'setupBackends':
        return {
          type: 'setupBackends',
          recommendation: script.recommendation(hardware, refreshed),
        };
      case 'setupVersions': {
        // What an earlier install in this scenario downloaded is marked, as the service does.
        const versions = (VERSIONS[request.backend] ?? []).map((v) => ({
          ...v,
          installed: installed.has(v.engine),
        }));
        return { type: 'setupVersions', versions };
      }
      case 'setupNetworks': {
        const mark = (n: NetworkChoice) => ({ ...n, installed: installed.has(n.network) });
        const networks = {
          ...NETWORKS,
          networks: NETWORKS.networks.map(mark),
          human: NETWORKS.human && mark(NETWORKS.human),
        };
        return { type: 'setupNetworks', networks };
      }
      case 'setupLicences':
        return {
          type: 'setupLicences',
          licences: isCuda(request.engine) ? CUDA_LICENCES : [],
          accepted: [...accepted],
        };
      case 'setupInstall':
        if (job && job.outcome === null) throw new TransportError('setupBusy', 'a job is running');
        request.acceptLicences.forEach((hash) => accepted.add(hash));
        runJob(request.engine, request.network, request.benchmark);
        return { type: 'ok' };
      case 'setupCancel':
        if (timer) clearTimeout(timer);
        if (job && job.outcome === null) {
          job.outcome = { outcome: 'cancelled' };
          publish();
        }
        return { type: 'ok' };
      case 'setupStatus':
        return { type: 'setupStatus', job };
      case 'setupImportNetwork':
        return {
          type: 'setupImportNetwork',
          network: { id: 'imported-0123456789abcdef', name: 'my-network', sizeBytes: 98_000_000 },
        };
      case 'setupInstalled':
        return { type: 'setupInstalled', active, unusedBytes: active ? 1.3 * GiB : 0 };
      case 'setupRemoveUnused':
        return { type: 'setupRemoved', freedBytes: 1.3 * GiB };
      case 'settingsGet':
        return { type: 'settings', settings };
      case 'settingsSet':
        settings = request.settings;
        transport.emit({ type: 'settingsChanged', settings });
        return { type: 'settings', settings };
      case 'jobStart':
        startFakeJob(request.options);
        return { type: 'ok' };
      case 'jobStop':
        stopFakeJob();
        return { type: 'ok' };
      case 'cacheClear': {
        if (request.scope === 'position') {
          const reply = game({ type: 'gameSnapshot' });
          if (reply?.type !== 'game' || reply.snapshot.positionKey === null) return { type: 'ok' };
          results.delete(reply.snapshot.positionKey);
          feed?.clear(reply.snapshot.positionKey);
        } else {
          stopFakeJob();
          results.clear();
          feed?.clear();
        }
        const { revision, nodes } = analysedTrend();
        transport.emit({ type: 'gameTrend', reason: 'reset', revision, nodes });
        return { type: 'ok' };
      }
      case 'cacheStats':
        return {
          type: 'cacheStats',
          usedBytes: results.size * 6 * 1024,
          capBytes: settings.cacheCapMb * 1024 * 1024,
          persistent: true,
          reason: null,
        };
      case 'gameScore': {
        const reply = game({ type: 'gameSnapshot' });
        if (request.mode.kind === 'estimate' || reply?.type !== 'game')
          throw new TransportError('scoreUnavailable', 'the scenarios have no ownership');
        return { type: 'score', ...finalCount(reply.snapshot, request.mode.dead) };
      }
      case 'gameTrend':
        return analysedTrend();
      default: {
        const answer = game(request);
        if (answer) return answer;
        // Every request type is answered today; this catches one added to the protocol later.
        const type = (request as { type: string }).type;
        unhandled.push(type);
        throw new TransportError('internal', `scenario ${name} does not answer ${type}`);
      }
    }
  }

  return transport;
}
