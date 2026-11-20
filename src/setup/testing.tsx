import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../i18n/createI18n';
import type { Language } from '../i18n/language';
import { useSettingsSync } from '../settings/useSettingsSync';
import { createFakeTransport, type FakeTransport } from '../transport/fake';
import type { BackendRecommendation } from '../transport/generated/BackendRecommendation';
import type { EngineVersionChoice } from '../transport/generated/EngineVersionChoice';
import type { HardwareReport } from '../transport/generated/HardwareReport';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import type { LicenceInfo } from '../transport/generated/LicenceInfo';
import type { NetworkList } from '../transport/generated/NetworkList';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import type { UiSettings } from '../transport/generated/UiSettings';
import { TransportProvider } from '../transport/TransportProvider';
import { SetupPanel } from './SetupPanel';
import { initialWizard, useWizardStore, type WizardState } from './wizardStore';

/** Shared fixtures for the setup tests and the development scenarios. */

const GiB = 1024 ** 3;

export const nvidiaHardware: HardwareReport = {
  os: { kind: 'windows', version: '11', arch: 'x86_64' },
  cpu: { name: 'AMD Ryzen 7 7700', cores: 8, threads: 16, avx2: true },
  memoryBytes: 32 * GiB,
  gpus: [
    {
      vendor: 'nvidia',
      name: 'NVIDIA GeForce RTX 5070',
      memoryBytes: 12 * GiB,
      driverVersion: '581.15',
      pciDeviceId: 0x2f04,
      appleGpuCores: null,
      computeCapability: '12.0',
      software: false,
    },
  ],
  problems: [],
};

export const nvidiaRecommendation: BackendRecommendation = {
  platform: 'windows-x64',
  gpu: nvidiaHardware.gpus[0],
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
};

/** The same machine with a driver too old for CUDA. */
export const oldDriverRecommendation: BackendRecommendation = {
  ...nvidiaRecommendation,
  gpu: { ...nvidiaHardware.gpus[0], driverVersion: '566.36' },
  backends: nvidiaRecommendation.backends.filter((b) => b.backend !== 'cuda'),
  default: 'directml',
  fallbacks: ['opencl', 'eigenavx2'],
  notes: ['driverTooOldForCuda'],
  driver: { current: '566.36', required: '580.00' },
};

export const versions: EngineVersionChoice[] = [
  {
    engine: 'katago-v1.18.2-cuda13.2-windows-x64',
    version: '1.18.2',
    released: '2026-08-30',
    downloadBytes: 9_000_000,
    runtimeBytes: 1_200_000_000,
    latest: true,
  },
  {
    engine: 'katago-v1.18.1-cuda13.2-windows-x64',
    version: '1.18.1',
    released: '2026-08-24',
    downloadBytes: 9_000_000,
    runtimeBytes: 1_200_000_000,
    latest: false,
  },
];

export const networks: NetworkList = {
  networks: [
    {
      network: 'tf3-b11c768-s12382M-d6533M',
      family: 'b11c768',
      elo: 14640,
      uploaded: '2026-11-01',
      sizeBytes: 180_000_000,
    },
    {
      network: 'zhizi-b40c768nbt-s11272M-d5935M',
      family: 'b40c768nbt',
      elo: 14523,
      uploaded: '2026-06-06',
      sizeBytes: 600_000_000,
    },
  ],
  preselected: 'tf3-b11c768-s12382M-d6533M',
  human: null,
};

export const cudaLicences: LicenceInfo[] = [
  {
    name: 'CUDA Toolkit EULA',
    url: 'https://docs.nvidia.com/cuda/eula/',
    textSha256: 'aa'.repeat(32),
    components: [
      { name: 'cudart', version: '13.2', bytes: 600 * 1024 * 1024 },
      { name: 'cublas', version: '13.2', bytes: 400 * 1024 * 1024 },
    ],
  },
  {
    name: 'cuDNN Software License Agreement',
    url: 'https://docs.nvidia.com/deeplearning/cudnn/sla/',
    textSha256: 'bb'.repeat(32),
    components: [{ name: 'cudnn', version: '9.8', bytes: 700 * 1024 * 1024 }],
  },
];

const ENGINE = 'katago-v1.18.2-cuda13.2-windows-x64';
const NETWORK = 'tf3-b11c768-s12382M-d6533M';

/** A CUDA job part way through: engine done, runtime downloading. */
export const runningJob: JobSnapshot = {
  id: 7,
  engine: ENGINE,
  backend: 'cuda',
  network: NETWORK,
  tasks: [
    { task: 'engine', state: { state: 'done' } },
    { task: 'runtime', state: { state: 'running', done: 62, total: 100 } },
    { task: 'network', state: { state: 'reused' } },
    { task: 'benchmark', state: { state: 'waiting' } },
    { task: 'testQuery', state: { state: 'waiting' } },
  ],
  outcome: null,
};

const failedTasks: JobSnapshot['tasks'] = [
  { task: 'engine', state: { state: 'done' } },
  { task: 'runtime', state: { state: 'done' } },
  { task: 'network', state: { state: 'done' } },
  { task: 'benchmark', state: { state: 'failed', failure: 'gpuDriverTooOld' } },
  { task: 'testQuery', state: { state: 'waiting' } },
];

const directmlOffer = {
  backend: 'directml' as const,
  engine: 'katago-v1.18.2-directml-windows-x64',
  downloadBytes: 24 * 1024 * 1024,
  runtimeBytes: null,
};

/** A1: the driver is too old for this CUDA build. */
export const driverFailedJob: JobSnapshot = {
  ...runningJob,
  tasks: failedTasks,
  outcome: {
    outcome: 'failed',
    failure: 'gpuDriverTooOld',
    stderrTail: ['CUDA Error: CUDA driver version is insufficient for CUDA runtime version'],
    offer: directmlOffer,
    driver: { current: '566.36', required: '580.00' },
  },
};

/** A2: a GPU error with DirectML to fall back to. */
export const gpuFailedJob: JobSnapshot = {
  ...runningJob,
  tasks: failedTasks.map((row) =>
    row.task === 'benchmark'
      ? { task: 'benchmark', state: { state: 'failed', failure: 'gpuError' } }
      : row,
  ),
  outcome: {
    outcome: 'failed',
    failure: 'gpuError',
    stderrTail: [
      'CUDA Error: an illegal memory access was encountered',
      'file: cudahelpers.cu line: 54',
    ],
    offer: directmlOffer,
    driver: null,
  },
};

/** B: the network download failed, and no other backend would help. */
export const downloadFailedJob: JobSnapshot = {
  ...runningJob,
  tasks: [
    { task: 'engine', state: { state: 'done' } },
    { task: 'network', state: { state: 'failed', failure: 'downloadFailed' } },
    { task: 'benchmark', state: { state: 'waiting' } },
    { task: 'testQuery', state: { state: 'waiting' } },
  ],
  outcome: {
    outcome: 'failed',
    failure: 'downloadFailed',
    stderrTail: [],
    offer: null,
    driver: null,
  },
};

export const storedSettings: UiSettings = {
  language: 'zh-CN',
  theme: 'system',
  discLines: ['winrate', 'scoreLead'],
  visitLimit: null,
};

/** Answers every setup request from the fixtures; `overrides` replace single request types. */
export function setupTransport(
  overrides: Partial<
    Record<Request['type'], (request: Request) => Response | Promise<Response>>
  > = {},
): FakeTransport & { requests: Request[] } {
  const requests: Request[] = [];
  const transport = createFakeTransport((request) => {
    requests.push(request);
    const override = overrides[request.type];
    if (override) return override(request);
    switch (request.type) {
      case 'setupDetect':
        return { type: 'setupDetect', hardware: nvidiaHardware };
      case 'setupBackends':
        return { type: 'setupBackends', recommendation: nvidiaRecommendation };
      case 'setupVersions':
        return { type: 'setupVersions', versions };
      case 'setupNetworks':
        return { type: 'setupNetworks', networks };
      case 'setupLicences':
        return { type: 'setupLicences', licences: [], accepted: [] };
      case 'setupInstall':
      case 'setupCancel':
        return { type: 'ok' };
      case 'setupStatus':
        return { type: 'setupStatus', job: null };
      case 'settingsGet':
        return { type: 'settings', settings: storedSettings };
      case 'settingsSet':
        return { type: 'settings', settings: request.settings };
      default:
        throw new Error(`unexpected request ${request.type}`);
    }
  });
  return Object.assign(transport, { requests });
}

function Harness() {
  useSettingsSync();
  return <SetupPanel />;
}

/** Renders the setup panel, with settings sync, from the given wizard state. */
export function renderSetup(
  transport: FakeTransport,
  state: Partial<WizardState> = {},
  { language = 'zh-CN', strict = false }: { language?: Language; strict?: boolean } = {},
) {
  useWizardStore.setState({ ...initialWizard, open: true, ...state });
  const i18n = createI18n(language);
  const tree = (
    <I18nextProvider i18n={i18n}>
      <TransportProvider transport={transport}>
        <Harness />
      </TransportProvider>
    </I18nextProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** The engine and network every install fixture uses. */
export const chosen = { backend: 'cuda' as const, engine: ENGINE, network: NETWORK };
