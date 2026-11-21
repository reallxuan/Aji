import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { usePanelStore } from '../app/panelStore';
import { useEngineStore } from '../engine/engineStore';
import { formatBytes } from '../setup/format';
import { backendName } from '../setup/labels';
import { useBenchmarkStore } from '../setup/benchmarkStore';
import { useWizardStore } from '../setup/wizardStore';
import { getInstalled, removeUnused, restartEngine, stopEngine } from '../transport/api';
import type { ActiveSummary } from '../transport/generated/ActiveSummary';
import type { DiscField } from '../transport/generated/DiscField';
import type { UiSettings } from '../transport/generated/UiSettings';
import { toTransportError, type Transport } from '../transport/transport';
import { useTransport } from '../transport/TransportProvider';
import { BenchmarkRow } from './BenchmarkRow';
import { DiscPreview } from './DiscPreview';
import { PanelTitle } from './NoticeView';
import { RulesControl } from './RulesControl';
import { useSettingsStore } from './settingsStore';

/** What the controls show before the stored settings arrive; they stay disabled until then. */
const DEFAULTS: UiSettings = {
  language: 'system',
  theme: 'system',
  discLines: ['winrate', 'scoreLead'],
  visitLimit: null,
  defaultRules: { kind: 'chinese' },
  showCoordinates: true,
  perspective: 'black',
};
const FIELDS: DiscField[] = ['winrate', 'scoreLead', 'visits'];
/** The rules control with the settings page's label column. */
const RULES_LAYOUT = 'settings';

const toMain = () => usePanelStore.getState().show('main');
const toAbout = () => usePanelStore.getState().show('about');
const setUpAgain = () => {
  usePanelStore.getState().show('main');
  useWizardStore.getState().openWizard(true);
};

/** Settings (mockup S): every change applies at once, with no Save button and no restart. */
export function SettingsPanel() {
  const { t } = useTranslation();
  const transport = useTransport();
  const stored = useSettingsStore((s) => s.settings);
  const settings = stored ?? DEFAULTS;
  const loaded = stored !== null;

  const save = (patch: Partial<UiSettings>) => {
    const current = useSettingsStore.getState().settings;
    if (!current) return;
    // A failure puts the previous settings back; the control shows them again.
    useSettingsStore
      .getState()
      .save(transport, { ...current, ...patch })
      .catch(() => undefined);
  };

  const languageOptions: Array<[UiSettings['language'], string]> = [
    ['system', t('settings.followSystem')],
    ['zh-CN', t('languageName.zhHans')],
    ['en', t('languageName.en')],
  ];
  const themeOptions: Array<[UiSettings['theme'], string]> = [
    ['system', t('settings.followSystem')],
    ['dark', t('settings.dark')],
    ['light', t('settings.light')],
  ];
  const coordinates = settings.showCoordinates ? 'show' : 'hide';
  const coordinateOptions: Array<['show' | 'hide', string]> = [
    ['show', t('settings.coordinatesShow')],
    ['hide', t('settings.coordinatesHide')],
  ];

  /** Taking the other line's field swaps the two, so the lines stay different. */
  const setDiscLine = (index: 0 | 1, field: DiscField) => {
    const lines = [...settings.discLines] as [DiscField, DiscField];
    const other = index === 0 ? 1 : 0;
    if (lines[other] === field) lines[other] = lines[index];
    lines[index] = field;
    save({ discLines: lines });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelTitle title={t('settings.title')} onBack={toMain} backLabel={t('settings.back')} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <Section title={t('settings.interface')}>
          <Row label={t('settings.language')}>
            <Choice
              label={t('settings.language')}
              value={settings.language}
              disabled={!loaded}
              onChange={(language) => save({ language })}
              options={languageOptions}
            />
          </Row>
          <Row label={t('settings.theme')}>
            <Choice
              label={t('settings.theme')}
              value={settings.theme}
              disabled={!loaded}
              onChange={(theme) => save({ theme })}
              options={themeOptions}
            />
          </Row>
          <Row label={t('settings.coordinates')}>
            <Choice
              label={t('settings.coordinates')}
              value={coordinates}
              disabled={!loaded}
              onChange={(choice) => save({ showCoordinates: choice === 'show' })}
              options={coordinateOptions}
            />
          </Row>
        </Section>

        <Section title={t('settings.analysis')}>
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-2">
              {([0, 1] as const).map((index) => (
                <Row
                  key={index}
                  label={t(index === 0 ? 'settings.discLine1' : 'settings.discLine2')}
                >
                  <Select
                    value={settings.discLines[index]}
                    disabled={!loaded}
                    onValueChange={(field) => setDiscLine(index, field as DiscField)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-32"
                      aria-label={t(index === 0 ? 'settings.discLine1' : 'settings.discLine2')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELDS.map((field) => (
                        <SelectItem key={field} value={field}>
                          {t(`settings.fields.${field}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
              ))}
            </div>
            <DiscPreview lines={settings.discLines} />
          </div>
          <RulesControl
            layout={RULES_LAYOUT}
            ruleLabel={t('settings.defaultRules')}
            value={settings.defaultRules}
            onChange={(defaultRules) => save({ defaultRules })}
          />
          <p className="text-[12px] text-text-muted">{t('settings.defaultRulesNote')}</p>
          <Row label={t('settings.visitLimit')}>
            <VisitLimit
              value={settings.visitLimit}
              disabled={!loaded}
              onCommit={(visitLimit) => save({ visitLimit })}
            />
          </Row>
          <p className="text-[12px] text-text-muted">{t('settings.visitLimitNote')}</p>
        </Section>

        <EngineSection transport={transport} />

        <button
          type="button"
          className="mt-4 flex w-full items-center px-6 py-3 text-left text-[14px] hover:bg-divider-soft"
          onClick={toAbout}
        >
          <span className="flex-1">{t('settings.about')}</span>
          <ChevronRightIcon className="size-4 text-text-muted" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-hairline px-6 py-5">
      <h3 className="mb-3 text-[12px] text-text-muted">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 text-[14px]">
      <span className="w-36 shrink-0">{label}</span>
      {children}
    </div>
  );
}

/** A segmented control: one of a few options. */
function Choice<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  disabled: boolean;
  onChange(value: T): void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value}
      disabled={disabled}
      // Clicking the chosen item again would clear it; a setting always has a value.
      onValueChange={(next) => next && onChange(next as T)}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem key={option} value={option} className="px-3">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * The visit limit: digits only, empty for no limit. It is stored on blur or Enter rather than on
 * every keystroke, so typing 1000 does not restart the search at 1, 10 and 100.
 */
function VisitLimit({
  value,
  disabled,
  onCommit,
}: {
  value: number | null;
  disabled: boolean;
  onCommit(value: number | null): void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  // A stored change from elsewhere (another window, a revert) replaces the draft. Adjusting
  // state during render keeps the same input element, so focus is not lost.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value === null ? '' : String(value));
  }
  const commit = () => {
    const parsed = draft === '' ? 0 : Number(draft);
    const next = parsed > 0 ? parsed : null;
    setDraft(next === null ? '' : String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={t('settings.visitLimit')}
      placeholder={t('settings.visitLimitNone')}
      className="h-8 w-32 rounded-md border border-hairline bg-transparent px-2.5 text-[14px] tabular-nums outline-none placeholder:text-text-muted focus-visible:border-text-muted"
      value={draft}
      maxLength={9}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 9))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}

/**
 * The active engine and its thread count with the benchmark on request, G1's restart and stop,
 * set up again, and the unused-files cleanup.
 */
function EngineSection({ transport }: { transport: Transport }) {
  const { t, i18n } = useTranslation();
  const engine = useEngineStore((s) => s.engine);
  const [installed, setInstalled] = useState<{
    active: ActiveSummary | null;
    unusedBytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    getInstalled(transport).then(
      (result) => {
        if (active) setInstalled(result);
      },
      () => {
        // The section then shows no summary; the engine buttons still work.
      },
    );
    return () => {
      active = false;
    };
  }, [transport, refresh]);

  const run = async (action: (transport: Transport) => Promise<unknown>) => {
    setError(null);
    try {
      await action(transport);
    } catch (failure) {
      setError(t(`errors.${toTransportError(failure).code}`));
    }
  };

  const deleteUnused = async () => {
    setConfirming(false);
    await run(removeUnused);
    setRefresh((n) => n + 1);
  };

  const state = engine?.state ?? null;
  const noEngine = state === null || state === 'notConfigured';
  // A benchmark started here holds the engine and the files until it ends, as the backend
  // refuses restart, setup and delete meanwhile.
  const measuring = useBenchmarkStore((s) => s.job !== null && s.job.outcome === null);
  // While KataGo starts restart is refused with engineBusy.
  const busy = state === 'starting' || measuring;
  const active = installed?.active ?? null;
  const unused = installed && installed.unusedBytes > 0 ? installed.unusedBytes : null;
  const unusedSize = unused === null ? '' : formatBytes(unused, i18n.language);

  return (
    <Section title={t('settings.engine')}>
      <div className="text-[14px]">
        {active ? (
          <>
            <p>
              {t('settings.engineLine', {
                version: active.version,
                backend: backendName(t, active.backend),
              })}
            </p>
            <p className="mt-1 text-[13px] text-text-muted">
              {t('settings.networkLine', { network: active.networkName })}
            </p>
            <div className="mt-3">
              <BenchmarkRow active={active} disabled={noEngine || busy} onMeasured={reload} />
            </div>
          </>
        ) : (
          installed && <p className="text-text-muted">{t('settings.noEngine')}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={noEngine || busy}
          onClick={() => void run(restartEngine)}
        >
          {t('engine.action.restart')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={noEngine || busy || state === 'stopped'}
          onClick={() => void run(stopEngine)}
        >
          {t('engine.action.stop')}
        </Button>
        <Button variant="outline" size="sm" disabled={measuring} onClick={setUpAgain}>
          {t('engine.action.setupAgain')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-engine-error">
          {error}
        </p>
      )}
      {unused !== null && (
        <div className="flex items-center gap-3 text-[14px]">
          <span className="flex-1">{t('settings.unused')}</span>
          <span className="text-[13px] text-text-muted tabular-nums">{unusedSize}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={measuring}
            onClick={() => setConfirming(true)}
          >
            {t('settings.delete')}
          </Button>
        </div>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>{t('settings.confirmTitle')}</DialogTitle>
          <DialogDescription>{t('settings.confirmBody', { size: unusedSize })}</DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('settings.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void deleteUnused()}>
              {t('settings.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
