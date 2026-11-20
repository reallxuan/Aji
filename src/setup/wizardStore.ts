import { create } from 'zustand';
import type { Backend } from '../transport/generated/Backend';
import type { BackendRecommendation } from '../transport/generated/BackendRecommendation';
import type { EngineVersionChoice } from '../transport/generated/EngineVersionChoice';
import type { HardwareReport } from '../transport/generated/HardwareReport';
import type { ImportedNetwork } from '../transport/generated/ImportedNetwork';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import type { NetworkChoice } from '../transport/generated/NetworkChoice';
import type { NetworkList } from '../transport/generated/NetworkList';

export type WizardStep = 'detect' | 'backend' | 'version' | 'network' | 'licence' | 'install';

export interface WizardData {
  /** Opened explicitly (a re-run, or an install in progress). */
  open: boolean;
  /** Opened from settings or the crashed state over a working setup: "set up later" reads "cancel". */
  rerun: boolean;
  /** "Set up later" was chosen this run, so a missing engine no longer opens the wizard. */
  dismissed: boolean;
  step: WizardStep;
  hardware: HardwareReport | null;
  recommendation: BackendRecommendation | null;
  backend: Backend | null;
  versions: EngineVersionChoice[] | null;
  engine: string | null;
  networks: NetworkChoice[] | null;
  /** Networks imported this run, newest first; they are listed above the catalogue. */
  imported: ImportedNetwork[];
  network: string | null;
  job: JobSnapshot | null;
  /** True between pressing install and the first progress snapshot. */
  starting: boolean;
}

export interface WizardActions {
  openWizard(rerun: boolean): void;
  close(): void;
  goTo(step: WizardStep): void;
  setHardware(hardware: HardwareReport): void;
  /** A new recommendation chooses its default backend. */
  setRecommendation(recommendation: BackendRecommendation): void;
  chooseBackend(backend: Backend): void;
  /** Chooses the latest version unless one of the list is already chosen. */
  setVersions(versions: EngineVersionChoice[]): void;
  chooseEngine(engine: string): void;
  /** Chooses the preselected network unless one is already chosen. */
  setNetworks(list: NetworkList): void;
  addImported(network: ImportedNetwork): void;
  chooseNetwork(network: string): void;
  applyProgress(job: JobSnapshot): void;
}

export type WizardState = WizardData & WizardActions;

/** Everything the wizard collects, as at step 1. */
const fresh = {
  step: 'detect',
  hardware: null,
  recommendation: null,
  backend: null,
  versions: null,
  engine: null,
  networks: null,
  imported: [],
  network: null,
  job: null,
  starting: false,
} satisfies Partial<WizardData>;

export const initialWizard: WizardData = { open: false, rerun: false, dismissed: false, ...fresh };

export const useWizardStore = create<WizardState>()((set) => ({
  ...initialWizard,
  openWizard: (rerun) => set({ ...fresh, open: true, rerun }),
  close: () => set({ ...fresh, open: false, rerun: false, dismissed: true }),
  goTo: (step) => set({ step }),
  setHardware: (hardware) => set({ hardware }),
  setRecommendation: (recommendation) =>
    set((state) => {
      const backend = recommendation.default;
      return backend === state.backend
        ? { recommendation }
        : { recommendation, backend, versions: null, engine: null, networks: null, network: null };
    }),
  chooseBackend: (backend) =>
    set((state) =>
      backend === state.backend
        ? state
        : { backend, versions: null, engine: null, networks: null, network: null },
    ),
  setVersions: (versions) =>
    set((state) => {
      if (versions.some((v) => v.engine === state.engine)) return { versions };
      const engine = (versions.find((v) => v.latest) ?? versions[0])?.engine ?? null;
      return { versions, engine, networks: null, network: null };
    }),
  chooseEngine: (engine) =>
    set((state) => (engine === state.engine ? state : { engine, networks: null, network: null })),
  setNetworks: (list) =>
    set((state) => {
      const known =
        state.imported.some((n) => n.id === state.network) ||
        list.networks.some((n) => n.network === state.network);
      return { networks: list.networks, network: known ? state.network : list.preselected };
    }),
  addImported: (network) =>
    set((state) => ({
      imported: [network, ...state.imported.filter((n) => n.id !== network.id)],
      network: network.id,
    })),
  chooseNetwork: (network) => set({ network }),
  applyProgress: (job) => set({ job }),
}));
