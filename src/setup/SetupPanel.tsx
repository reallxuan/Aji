import { cn } from 'cn';
import { useTranslation } from 'react-i18next';
import type { Language } from '../i18n/language';
import { useSettingsStore } from '../settings/settingsStore';
import { getSettings } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { StepBackend } from './StepBackend';
import { StepInstall } from './StepInstall';
import { StepLicence } from './StepLicence';
import { StepNetwork } from './StepNetwork';
import { StepVersion } from './StepVersion';
import { useWizardStore, type WizardStep } from './wizardStore';

/** Four parts: hardware and backend, version, network, then the licence and the install. */
const SEGMENT: Record<WizardStep, number> = {
  backend: 0,
  version: 1,
  network: 2,
  licence: 3,
  install: 3,
};
const SEGMENTS = 4;

/** The setup wizard in the right-hand panel: title row, four-part progress line, then the step. */
export function SetupPanel() {
  const { t } = useTranslation();
  const step = useWizardStore((s) => s.step);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-7 pt-6">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text-muted">{t('setup.title')}</span>
          <LanguageSwitch />
        </div>
        <ProgressLine segment={SEGMENT[step]} />
      </header>
      {step === 'backend' && <StepBackend />}
      {step === 'version' && <StepVersion />}
      {step === 'network' && <StepNetwork />}
      {step === 'licence' && <StepLicence />}
      {step === 'install' && <StepInstall />}
    </div>
  );
}

function ProgressLine({ segment }: { segment: number }) {
  const { t } = useTranslation();
  return (
    <div
      role="progressbar"
      aria-label={t('setup.title')}
      aria-valuemin={1}
      aria-valuemax={SEGMENTS}
      aria-valuenow={segment + 1}
      className="mt-3 grid grid-cols-4 gap-1.5"
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={cn('h-0.5 rounded-full', i <= segment ? 'bg-text' : 'bg-hairline')}
        />
      ))}
    </div>
  );
}

/** `中文 · EN`: writes the language setting, as the settings page does (K2). */
function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const current: Language = i18n.language === 'en' ? 'en' : 'zh-CN';

  const choose = async (language: Language) => {
    if (language === current) return;
    try {
      const base = useSettingsStore.getState().settings ?? (await getSettings(transport));
      await useSettingsStore.getState().save(transport, { ...base, language });
    } catch {
      // The store has put the previous settings back; the language stays as it was.
    }
  };

  const option = (language: Language, label: string) => (
    <button
      type="button"
      aria-pressed={current === language}
      className={cn(current === language ? 'text-text' : 'text-text-muted hover:text-text')}
      onClick={() => void choose(language)}
    >
      {label}
    </button>
  );

  const chinese = option('zh-CN', t('languageName.zh'));
  const english = option('en', t('languageName.enShort'));

  return (
    <div className="flex items-center gap-2 text-[12px]">
      {chinese}
      <span aria-hidden className="size-0.5 rounded-full bg-text-muted" />
      {english}
    </div>
  );
}
