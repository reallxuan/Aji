import { ArrowUpRightIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { openExternal } from '../platform/openExternal';
import { getLicences, getVersions } from '../transport/api';
import type { Backend } from '../transport/generated/Backend';
import type { BackendRecommendation } from '../transport/generated/BackendRecommendation';
import type { FallbackOffer } from '../transport/generated/FallbackOffer';
import type { LicenceInfo } from '../transport/generated/LicenceInfo';
import type { LicensedComponent } from '../transport/generated/LicensedComponent';
import type { Transport } from '../transport/transport';
import { useTransport } from '../transport/TransportProvider';
import { formatBytes } from './format';
import { LoadError, StepLayout } from './parts';
import { useWizardStore } from './wizardStore';

const toNetwork = () => useWizardStore.getState().backTo('network');

/** A component's name and version, as the manifest gives them (data, not interface text). */
const componentLabel = (component: LicensedComponent) => `${component.name} ${component.version}`;

/** The backend after `current` in the recommendation, for the offer a declined licence leads to. */
function nextBackend(recommendation: BackendRecommendation | null, current: Backend | null) {
  const backends = recommendation?.backends.map((b) => b.backend) ?? [];
  const index = current ? backends.indexOf(current) : -1;
  return backends.slice(index + 1).find((b) => b !== current) ?? null;
}

/** The offer for the next backend's newest engine; `null` when there is none or it cannot load. */
async function nextOffer(transport: Transport): Promise<FallbackOffer | null> {
  const { recommendation, backend } = useWizardStore.getState();
  const next = nextBackend(recommendation, backend);
  if (!next) return null;
  try {
    const versions = await getVersions(transport, next);
    const version = versions.find((v) => v.latest) ?? versions[0];
    return version
      ? {
          backend: next,
          engine: version.engine,
          downloadBytes: version.downloadBytes,
          runtimeBytes: version.runtimeBytes,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * The gate before every install. With every licence already accepted it starts the install at
 * once; otherwise it shows the licences (mockup C) and installs only after the box is ticked.
 */
export function StepLicence() {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const engine = useWizardStore((s) => s.engine);
  const [pending, setPending] = useState<LicenceInfo[] | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [ticked, setTicked] = useState(false);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    if (!engine) return;
    let active = true;
    getLicences(transport, engine).then(
      ({ licences, accepted }) => {
        if (!active) return;
        const open = licences.filter((licence) => !accepted.includes(licence.textSha256));
        if (open.length === 0) void useWizardStore.getState().install(transport, []);
        else setPending(open);
      },
      (error) => {
        if (active) setFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, [transport, engine, attempt]);

  if (failure !== null) {
    return (
      <StepLayout title={t('setup.licence.title')}>
        <LoadError
          error={failure}
          onRetry={() => {
            setFailure(null);
            setAttempt((n) => n + 1);
          }}
        />
      </StepLayout>
    );
  }
  if (!pending) return <StepLayout title={t('setup.steps.install')} left={false} />;

  const accept = () =>
    void useWizardStore.getState().install(
      transport,
      pending.map((licence) => licence.textSha256),
    );
  const decline = async () => {
    setDeclining(true);
    useWizardStore.getState().decline(await nextOffer(transport));
  };

  return (
    <StepLayout
      title={t('setup.licence.title')}
      left={
        <Button
          variant="ghost"
          className="px-0 text-text-muted hover:bg-transparent hover:text-text"
          onClick={toNetwork}
        >
          {t('setup.install.back')}
        </Button>
      }
      actions={
        <>
          <Button variant="outline" disabled={declining} onClick={() => void decline()}>
            {t('setup.licence.decline')}
          </Button>
          <Button disabled={!ticked || declining} onClick={accept}>
            {t('setup.licence.acceptInstall')}
          </Button>
        </>
      }
    >
      <p className="text-[14px] text-text-muted">{t('setup.licence.intro')}</p>
      <ul className="mt-4 border-t border-hairline">
        {pending.map((licence) => (
          <li key={licence.textSha256} className="border-b border-hairline py-3.5 text-[14px]">
            <div className="flex items-center gap-3">
              <span className="flex-1">{licence.name}</span>
              <span className="text-[13px] text-text-muted tabular-nums">
                {formatBytes(
                  licence.components.reduce((sum, component) => sum + component.bytes, 0),
                  i18n.language,
                )}
              </span>
              <Button
                variant="link"
                className="h-auto px-0 text-text"
                onClick={() => void openExternal(licence.url).catch(() => undefined)}
              >
                {t('setup.licence.view')}
                <ArrowUpRightIcon aria-hidden />
              </Button>
            </div>
            {/* What the licence covers, so the user sees each component and its size (5.2). */}
            <ul className="mt-1.5 text-[13px] text-text-muted">
              {licence.components.map((component) => (
                <li key={component.name} className="flex gap-3 py-0.5 pl-3">
                  <span className="flex-1">{componentLabel(component)}</span>
                  <span className="tabular-nums">
                    {formatBytes(component.bytes, i18n.language)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <label className="mt-5 flex cursor-pointer items-start gap-3 text-[14px]">
        <Checkbox
          className="mt-0.5"
          checked={ticked}
          onCheckedChange={(value) => setTicked(value === true)}
        />
        <span>{t('setup.licence.accept')}</span>
      </label>
    </StepLayout>
  );
}
