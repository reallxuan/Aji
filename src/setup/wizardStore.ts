import { create } from 'zustand';
import { detectHardware, getInstallStatus, startInstall } from '../transport/api';
import type { Backend } from '../transport/generated/Backend';
import type { BackendRecommendation } from '../transport/generated/BackendRecommendation';
import type { EngineVersionChoice } from '../transport/generated/EngineVersionChoice';
import type { FallbackOffer } from '../transport/generated/FallbackOffer';
import type { HardwareReport } from '../transport/generated/HardwareReport';
import type { ImportedNetwork } from '../transport/generated/ImportedNetwork';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';
import type { NetworkChoice } from '../transport/generated/NetworkChoice';
import type { NetworkList } from '../transport/generated/NetworkList';
import { toTransportError, type TransportError, type Transport } from '../transport/transport';

export type WizardStep = 'backend' | 'version' | 'network' | 'licence' | 'install';

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
  /** The licence hashes the last install accepted, so a retry sends them again. */
  acceptLicences: string[];
  /** Set when the licence was declined: panel A2 with this offer, without a job. */
  declined: { offer: FallbackOffer | null } | null;
  /** Why the last `setupInstall` was refused, other than `setupBusy`. */
  startError: TransportError | null;
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
  /**
   * Starts installing the chosen engine and network. Does nothing while a start is in flight or a
   * job runs, so a double click or a re-run effect sends one request. A `setupBusy` refusal shows
   * the job that is already running.
   */
  install(transport: Transport, acceptLicences: string[]): Promise<void>;
  /** Detects hardware again (the driver may have been updated), then installs the same choice. */
  retry(transport: Transport): Promise<void>;
  /** Accepts a fallback offer: its engine, the same network, through the licence check. */
  adoptOffer(offer: FallbackOffer): void;
  decline(offer: FallbackOffer | null): void;
  /** Leaves step 5 for an earlier step, keeping the choices. */
  backTo(step: WizardStep): void;
  /** Follows a job snapshot; an installed outcome closes the wizard. */
  applyProgress(job: JobSnapshot): void;
}

export type WizardState = WizardData & WizardActions;

/** Everything the wizard collects, as at step 1. */
const fresh = {
  step: 'backend',
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
  acceptLicences: [],
  declined: null,
  startError: null,
} satisfies Partial<WizardData>;

export const initialWizard: WizardData = { open: false, rerun: false, dismissed: false, ...fresh };

export const useWizardStore = create<WizardState>()((set, get) => ({
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
  async install(transport, acceptLicences) {
    const { starting, job, engine, network } = get();
    if (starting || (job !== null && job.outcome === null) || !engine || !network) return;
    set({
      starting: true,
      step: 'install',
      open: true,
      job: null,
      declined: null,
      startError: null,
      acceptLicences,
    });
    try {
      await startInstall(transport, engine, network, acceptLicences);
    } catch (error) {
      const refusal = toTransportError(error);
      if (refusal.code === 'setupBusy') {
        const running = await getInstallStatus(transport).catch(() => null);
        if (running) {
          get().applyProgress(running);
          return;
        }
      }
      set({ starting: false, startError: refusal });
    }
  },
  async retry(transport) {
    try {
      get().setHardware(await detectHardware(transport, true));
    } catch {
      // Retrying matters more than fresh hardware details.
    }
    await get().install(transport, get().acceptLicences);
  },
  adoptOffer: (offer) =>
    set({
      backend: offer.backend,
      engine: offer.engine,
      versions: null,
      networks: null,
      job: null,
      declined: null,
      startError: null,
      step: 'licence',
    }),
  decline: (offer) => set({ declined: { offer }, step: 'install' }),
  backTo: (step) => set({ step, job: null, declined: null, startError: null, starting: false }),
  applyProgress: (job) =>
    set(
      job.outcome?.outcome === 'installed'
        ? // The engine starts from the new set; `dismissed` keeps a brief "not configured" from
          // reopening the wizard before its state event arrives.
          { ...fresh, open: false, rerun: false, dismissed: true }
        : {
            job,
            engine: job.engine,
            network: job.network,
            backend: job.backend,
            starting: false,
            step: 'install',
            open: true,
            declined: null,
            startError: null,
          },
    ),
}));
