import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { getVersions } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { formatDate } from './format';
import { backendName, platformLabel } from './labels';
import { ChoiceList, ChoiceRow, LoadError, StepLayout } from './parts';
import { useWizardStore } from './wizardStore';

const toBackend = () => useWizardStore.getState().goTo('backend');
const toNetwork = () => useWizardStore.getState().goTo('network');

/** Step 3: KataGo versions for the chosen backend, newest first and chosen. */
export function StepVersion() {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const backend = useWizardStore((s) => s.backend);
  const platform = useWizardStore((s) => s.recommendation?.platform ?? null);
  const versions = useWizardStore((s) => s.versions);
  const engine = useWizardStore((s) => s.engine);
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const loaded = versions !== null;

  useEffect(() => {
    if (!backend || loaded) return;
    let active = true;
    getVersions(transport, backend).then(
      (result) => {
        // A reply for a backend the user has since left is dropped.
        if (active && useWizardStore.getState().backend === backend) {
          useWizardStore.getState().setVersions(result);
        }
      },
      (error) => {
        if (active) setFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, [transport, backend, loaded, attempt]);

  const subtitle = [backend && backendName(t, backend), platform && platformLabel(t, platform)]
    .filter(Boolean)
    .join(' · ');

  return (
    <StepLayout
      title={t('setup.steps.version')}
      subtitle={subtitle}
      actions={
        <>
          <Button variant="ghost" onClick={toBackend}>
            {t('setup.back')}
          </Button>
          <Button disabled={!engine} onClick={toNetwork}>
            {t('setup.next')}
          </Button>
        </>
      }
    >
      {versions && (
        <>
          <div className="flex px-3 pb-2 text-[0.75rem] text-text-muted">
            <span className="flex-1">{t('setup.version.columnVersion')}</span>
            <span>{t('setup.version.columnReleased')}</span>
          </div>
          <ChoiceList
            value={engine}
            onChange={(value) => useWizardStore.getState().chooseEngine(value)}
            label={t('setup.steps.version')}
          >
            {versions.map((version) => (
              <ChoiceRow key={version.engine} value={version.engine} showRadio={false}>
                <span className="font-medium">{version.version}</span>
                {version.latest && (
                  <span className="text-[0.8125rem] text-text-muted">
                    {t('setup.version.latest')}
                  </span>
                )}
                {version.installed && (
                  <span className="text-[0.8125rem] text-text-muted">{t('setup.downloaded')}</span>
                )}
                <span className="ml-auto text-[0.8125rem] text-text-muted tabular-nums">
                  {formatDate(version.released, i18n.language)}
                </span>
              </ChoiceRow>
            ))}
          </ChoiceList>
        </>
      )}
      {failure !== null && (
        <LoadError
          error={failure}
          onRetry={() => {
            setFailure(null);
            setAttempt((n) => n + 1);
          }}
        />
      )}
    </StepLayout>
  );
}
