import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useWizardStore } from '../setup/wizardStore';

const setUp = () => useWizardStore.getState().openWizard(false);

/** The panel body after "set up later": no engine, and one way to set it up (G2). */
export function NoEngine() {
  const { t } = useTranslation();
  return (
    <div className="px-6 py-8">
      <h2 className="text-[1.125rem] font-medium">{t('noEngine.title')}</h2>
      <p className="mt-2 text-[0.875rem] text-text-muted">{t('noEngine.body')}</p>
      <Button className="mt-6" onClick={setUp}>
        {t('noEngine.setup')}
      </Button>
    </div>
  );
}
