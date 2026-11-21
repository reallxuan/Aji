import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { getNetworks, importNetwork } from '../transport/api';
import { toTransportError } from '../transport/transport';
import { useTransport } from '../transport/TransportProvider';
import { formatDate } from './format';
import { ChoiceList, ChoiceRow, LoadError, StepLayout } from './parts';
import { useWizardStore } from './wizardStore';

const toVersion = () => useWizardStore.getState().goTo('version');
const toLicence = () => useWizardStore.getState().goTo('licence');

/** Step 4: networks the chosen engine can load, strongest first, plus any imported this run. */
export function StepNetwork() {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const engine = useWizardStore((s) => s.engine);
  const networks = useWizardStore((s) => s.networks);
  const imported = useWizardStore((s) => s.imported);
  const network = useWizardStore((s) => s.network);
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const loaded = networks !== null;

  useEffect(() => {
    if (!engine || loaded) return;
    let active = true;
    getNetworks(transport, engine).then(
      (list) => {
        if (active && useWizardStore.getState().engine === engine) {
          useWizardStore.getState().setNetworks(list);
        }
      },
      (error) => {
        if (active) setFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, [transport, engine, loaded, attempt]);

  const onImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const result = await importNetwork(transport);
      if (result) useWizardStore.getState().addImported(result);
    } catch (error) {
      setImportError(t(`errors.${toTransportError(error).code}`));
    } finally {
      setImporting(false);
    }
  };

  return (
    <StepLayout
      title={t('setup.steps.network')}
      actions={
        <>
          <Button variant="ghost" onClick={toVersion}>
            {t('setup.back')}
          </Button>
          <Button variant="outline" disabled={importing} onClick={() => void onImport()}>
            {t('setup.network.import')}
          </Button>
          <Button disabled={!network} onClick={toLicence}>
            {t('setup.network.start')}
          </Button>
        </>
      }
    >
      {networks && (
        <>
          <div className="flex gap-3 px-3 pb-2 text-[0.75rem] text-text-muted">
            <span className="w-5">{t('setup.network.columnIndex')}</span>
            <span className="flex-1">{t('setup.network.columnName')}</span>
            <span className="w-12 text-right">{t('setup.network.columnElo')}</span>
            <span className="w-24 text-right whitespace-nowrap">
              {t('setup.network.columnReleased')}
            </span>
          </div>
          <ChoiceList
            value={network}
            onChange={(value) => useWizardStore.getState().chooseNetwork(value)}
            label={t('setup.steps.network')}
          >
            {imported.map((item) => (
              <ChoiceRow key={item.id} value={item.id} showRadio={false}>
                <span className="w-5" />
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                <span className="w-12" />
                <span className="w-24 text-right whitespace-nowrap text-[0.8125rem] text-text-muted">
                  {t('setup.network.imported')}
                </span>
              </ChoiceRow>
            ))}
            {networks.map((item, index) => (
              <ChoiceRow key={item.network} value={item.network} showRadio={false}>
                <span className="w-5 text-[0.8125rem] text-text-muted tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium" title={item.network}>
                  {item.network}
                </span>
                {item.installed && (
                  <span className="shrink-0 text-[0.8125rem] whitespace-nowrap text-text-muted">
                    {t('setup.downloaded')}
                  </span>
                )}
                <span className="w-12 text-right font-medium tabular-nums">
                  {item.elo === null ? '' : Math.round(item.elo)}
                </span>
                <span className="w-24 text-right whitespace-nowrap text-[0.8125rem] text-text-muted tabular-nums">
                  {formatDate(item.uploaded, i18n.language)}
                </span>
              </ChoiceRow>
            ))}
          </ChoiceList>
        </>
      )}
      {importError && (
        <p role="alert" className="mt-3 text-[0.8125rem] text-engine-error">
          {importError}
        </p>
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
