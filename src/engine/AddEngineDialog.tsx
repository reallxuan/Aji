import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useEstimateStore } from '../analysis/estimateStore';
import { useActionContext } from '../game/useActionContext';
import { formatBytes } from '../setup/format';
import { backendName } from '../setup/labels';
import { ChoiceList, ChoiceRow, TaskRows } from '../setup/parts';
import { useWizardStore } from '../setup/wizardStore';
import {
  addOwnProfile,
  cancelInstall,
  getNetworks,
  importNetwork,
  pickFile,
  startInstall,
} from '../transport/api';
import type { NetworkChoice } from '../transport/generated/NetworkChoice';
import type { OwnFile } from '../transport/generated/OwnFile';
import type { PickPurpose } from '../transport/generated/PickPurpose';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import { toTransportError } from '../transport/transport';
import { useAddEngineStore } from './addEngineStore';
import { useProfileStore } from './profileStore';

type Way = 'download' | 'import' | 'own';
const WAYS: Way[] = ['download', 'import', 'own'];
const OWN_FILES: OwnFile[] = ['katago', 'model', 'config'];

interface Build {
  engine: string;
  version: string;
  backend: Extract<ProfileSummary['source'], { kind: 'managed' }>['backend'];
}

/** `1.18.2` against `1.16.4`, part by part. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The build a new network runs on (design 6.3): the current profile's, or the newest installed one
 * when one's own KataGo is current; `null` with no managed profile at all.
 */
function buildOf(profiles: ProfileSummary[]): Build | null {
  const managed = profiles.flatMap((p) =>
    p.source.kind === 'managed' ? [{ current: p.current, ...p.source }] : [],
  );
  const pick =
    managed.find((m) => m.current) ??
    managed.sort((a, b) => compareVersions(b.version, a.version))[0];
  return pick ? { engine: pick.engine, version: pick.version, backend: pick.backend } : null;
}

const close = () => useAddEngineStore.getState().setOpen(false);

/**
 * 添加引擎 (P2 M4 design 6.3, mockup section 2): download a network for the current build,
 * import a network file, or use one's own KataGo. The new profile becomes the current one.
 */
export function AddEngineDialog() {
  const { t, i18n } = useTranslation();
  const ctx = useActionContext();
  const open = useAddEngineStore((s) => s.open);
  const job = useAddEngineStore((s) => s.job);
  const target = useAddEngineStore((s) => s.target);
  const profiles = useProfileStore((s) => s.profiles);
  const [way, setWay] = useState<Way>('download');
  const [error, setError] = useState<string | null>(null);
  const build = buildOf(profiles);
  const installing = target !== null && (job === null || job.outcome === null);
  const outcome = job?.outcome ?? null;

  // The install ended: a new profile, current, or a failure to show.
  useEffect(() => {
    if (outcome?.outcome === 'installed') {
      useEstimateStore.getState().setScore(null);
      void useProfileStore.getState().load(ctx.transport);
      useAddEngineStore.getState().setTarget(null);
      close();
    } else if (outcome?.outcome === 'cancelled') {
      useAddEngineStore.getState().setTarget(null);
    }
  }, [outcome, ctx.transport]);

  const install = async (network: string) => {
    if (!build) return;
    setError(null);
    useAddEngineStore.getState().setTarget({ engine: build.engine, network });
    try {
      // The build is installed, so its licences were accepted then.
      await startInstall(ctx.transport, build.engine, network, [], { benchmark: false });
    } catch (failure) {
      useAddEngineStore.getState().setTarget(null);
      setError(t(`errors.${toTransportError(failure).code}`));
    }
  };

  const openWizard = () => {
    close();
    useWizardStore.getState().openWizard(true);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {/* One track that never grows past the dialog, so long segment labels wrap instead. */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[520px]">
        <DialogTitle>{t('engine.add.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('engine.add.title')}</DialogDescription>
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full"
          value={way}
          disabled={installing}
          onValueChange={(value) => {
            if (value) {
              setWay(value as Way);
              setError(null);
            }
          }}
        >
          {WAYS.map((w) => (
            <ToggleGroupItem
              key={w}
              value={w}
              className="h-auto min-h-9 min-w-0 flex-1 py-1 text-[0.8125rem] leading-tight whitespace-normal"
            >
              {t(`engine.add.ways.${w}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {way !== 'own' && !build ? (
          <NoBuild onOpenWizard={openWizard} />
        ) : installing || outcome?.outcome === 'failed' ? (
          <div className="text-[0.875rem]">
            {job && <TaskRows tasks={job.tasks} />}
            {outcome?.outcome === 'failed' && (
              <p role="alert" className="mt-2 text-engine-error">
                {t('engine.add.failed', { reason: t(`setup.failure.${outcome.failure}`) })}
              </p>
            )}
            <DialogFooter className="mt-4">
              {installing ? (
                <Button variant="outline" onClick={() => void cancelInstall(ctx.transport)}>
                  {t('engine.add.cancelInstall')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => useAddEngineStore.getState().setTarget(null)}
                >
                  {t('engine.add.back')}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : way === 'download' && build ? (
          <DownloadWay
            build={build}
            profiles={profiles}
            language={i18n.language}
            onInstall={(network) => void install(network)}
          />
        ) : way === 'import' && build ? (
          <ImportWay
            build={build}
            onImported={(network) => void install(network)}
            onError={setError}
          />
        ) : (
          <OwnWay />
        )}
        {error && (
          <p role="alert" className="text-[0.8125rem] text-engine-error">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoBuild({ onOpenWizard }: { onOpenWizard(): void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 text-[0.875rem]">
      <p className="text-text-muted">{t('engine.add.noBuild')}</p>
      <DialogFooter>
        <Button onClick={onOpenWizard}>{t('engine.add.openWizard')}</Button>
      </DialogFooter>
    </div>
  );
}

function BuildLine({ build }: { build: Build }) {
  const { t } = useTranslation();
  return (
    <p className="text-[0.75rem] text-text-muted">
      {t('engine.add.build', { version: build.version, backend: backendName(t, build.backend) })}
    </p>
  );
}

/** The manifest's networks for `build`; one a profile already uses is marked and not chosen. */
function DownloadWay({
  build,
  profiles,
  language,
  onInstall,
}: {
  build: Build;
  profiles: ProfileSummary[];
  language: string;
  onInstall(network: string): void;
}) {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const [networks, setNetworks] = useState<NetworkChoice[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inUse = (network: string) =>
    profiles.some(
      (p) =>
        p.source.kind === 'managed' &&
        p.source.engine === build.engine &&
        p.source.network === network,
    );

  useEffect(() => {
    let active = true;
    getNetworks(ctx.transport, build.engine).then(
      (list) => active && setNetworks(list.networks),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [ctx.transport, build.engine]);
  // Until one is chosen, the strongest network no profile uses yet.
  const selected = chosen ?? networks?.find((n) => !inUse(n.network))?.network ?? null;

  return (
    <div className="space-y-3">
      {failed && (
        <p role="alert" className="text-[0.8125rem] text-engine-error">
          {t('engine.add.networksFailed')}
        </p>
      )}
      {networks && (
        <div className="max-h-[280px] overflow-y-auto">
          <ChoiceList value={selected} onChange={setChosen} label={t('engine.add.ways.download')}>
            {networks.map((n) => {
              const used = inUse(n.network);
              return (
                <ChoiceRow key={n.network} value={n.network} disabled={used} showRadio={false}>
                  <span className="min-w-0 flex-1 truncate" title={n.network}>
                    {n.network}
                  </span>
                  <span className="shrink-0 text-[0.8125rem] whitespace-nowrap text-text-muted tabular-nums">
                    {used
                      ? t('engine.add.inUse')
                      : n.installed
                        ? t('setup.downloaded')
                        : formatBytes(n.sizeBytes, language)}
                  </span>
                </ChoiceRow>
              );
            })}
          </ChoiceList>
        </div>
      )}
      <BuildLine build={build} />
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          {t('engine.add.cancel')}
        </Button>
        <Button disabled={!selected} onClick={() => selected && onInstall(selected)}>
          {t('engine.add.downloadUse')}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** The existing import, then an install of the imported network with `build`. */
function ImportWay({
  build,
  onImported,
  onError,
}: {
  build: Build;
  onImported(network: string): void;
  onError(message: string): void;
}) {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    setBusy(true);
    try {
      const imported = await importNetwork(ctx.transport);
      if (imported) onImported(imported.id);
    } catch (failure) {
      onError(t(`errors.${toTransportError(failure).code}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-[0.875rem] text-text-muted">{t('engine.add.importNote')}</p>
      <BuildLine build={build} />
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          {t('engine.add.cancel')}
        </Button>
        <Button disabled={busy} onClick={() => void choose()}>
          {t('engine.add.chooseFile')}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** One's own KataGo, network and config, checked on the engine machine before they are added. */
function OwnWay() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const [paths, setPaths] = useState<Record<OwnFile, string>>({
    katago: '',
    model: '',
    config: '',
  });
  const [name, setName] = useState('');
  const [refused, setRefused] = useState<{ file: OwnFile; problem: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const set = (file: OwnFile, value: string) => {
    setPaths((p) => ({ ...p, [file]: value }));
    if (refused?.file === file) setRefused(null);
  };
  const browse = async (file: OwnFile) => {
    try {
      const path = await pickFile(ctx.transport, file satisfies PickPurpose);
      if (path) set(file, path);
    } catch (failure) {
      setError(t(`errors.${toTransportError(failure).code}`));
    }
  };
  const add = async () => {
    setChecking(true);
    setError(null);
    setRefused(null);
    try {
      const list = await addOwnProfile(ctx.transport, {
        ...paths,
        ...(name.trim() && { name: name.trim() }),
      });
      useProfileStore.setState(list);
      useEstimateStore.getState().setScore(null);
      close();
    } catch (failure) {
      const { code, detail } = toTransportError(failure);
      const [file, problem] = (detail ?? '').split(':');
      if (code === 'engineOwnFile' && OWN_FILES.includes(file as OwnFile))
        setRefused({ file: file as OwnFile, problem });
      else setError(t(`errors.${code}`));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-3">
      {OWN_FILES.map((file) => {
        const bad = refused?.file === file;
        return (
          <div key={file} data-field={file} className="space-y-1">
            <label className="block text-[0.75rem] text-text-muted" htmlFor={`own-${file}`}>
              {t(`engine.add.files.${file}`)}
            </label>
            <div className="flex gap-2">
              <input
                id={`own-${file}`}
                type="text"
                spellCheck={false}
                aria-invalid={bad}
                className="h-8 min-w-0 flex-1 rounded-md border border-hairline bg-transparent px-2 font-mono text-[0.75rem] outline-none focus-visible:border-text-muted aria-invalid:border-engine-error"
                value={paths[file]}
                onChange={(event) => set(file, event.target.value)}
              />
              <Button variant="outline" size="sm" onClick={() => void browse(file)}>
                {t('engine.add.browse')}
              </Button>
            </div>
            {bad && (
              <p className="text-[0.75rem] text-engine-error">
                {t(`engine.add.problems.${refused.problem}`)}
              </p>
            )}
          </div>
        );
      })}
      <div className="space-y-1">
        <label className="block text-[0.75rem] text-text-muted" htmlFor="own-name">
          {t('engine.add.name')}
        </label>
        <input
          id="own-name"
          type="text"
          placeholder={t('engine.add.namePlaceholder')}
          maxLength={80}
          className="h-8 w-full rounded-md border border-hairline bg-transparent px-2 text-[0.875rem] outline-none placeholder:text-text-muted focus-visible:border-text-muted"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-[0.8125rem] text-engine-error">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          {t('engine.add.cancel')}
        </Button>
        <Button
          disabled={checking || OWN_FILES.some((file) => !paths[file].trim())}
          onClick={() => void add()}
        >
          {t('engine.add.check')}
        </Button>
      </DialogFooter>
    </div>
  );
}
