import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { useDeviceStore } from '../device/deviceStore';
import { INTERFACE_SCALES, type InterfaceScale } from '../device/deviceSettings';
import type { DiscField } from '../transport/generated/DiscField';
import type { UiSettings } from '../transport/generated/UiSettings';
import { toTransportError, type Transport } from '../transport/transport';
import { useTransport } from '../transport/TransportProvider';
import { BenchmarkRow } from './BenchmarkRow';
import { DiscPreview } from './DiscPreview';
import { LayoutSettings } from '../layout/LayoutMenu';
import { BoardStyleControl } from './BoardStyleControl';
import { CacheRow } from './CacheRow';
import { PanelTitle } from './NoticeView';
import { RulesControl } from './RulesControl';
import { SETTINGS_LABEL, SETTINGS_ROW } from './rowClasses';
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
  showNextMove: true,
  analyseOnOpen: false,
  cacheCapMb: 1024,
  saveAnalysis: false,
  jobOptions: {
    range: { kind: 'whole' },
    side: 'both',
    visits: 500,
    boost: { on: true, threshold: 10, visits: 3000 },
  },
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
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const stored = useSettingsStore((s) => s.settings);
  const settings = stored ?? DEFAULTS;
  const loaded = stored !== null;
  const device = useDeviceStore((s) => s.settings);
  const updateDevice = useDeviceStore((s) => s.update);

  // The fields whose last save failed, said beside their controls for a moment (M5 minor 1).
  const [failed, setFailed] = useState<string[]>([]);
  const failedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (failedTimer.current) clearTimeout(failedTimer.current);
    },
    [],
  );
  const save = (patch: Partial<UiSettings>) => {
    const current = useSettingsStore.getState().settings;
    if (!current) return;
    // A failure puts the previous settings back; the control shows them again, with a word why.
    useSettingsStore
      .getState()
      .save(transport, { ...current, ...patch })
      .catch(() => {
        setFailed(Object.keys(patch));
        if (failedTimer.current) clearTimeout(failedTimer.current);
        failedTimer.current = setTimeout(() => setFailed([]), SAVE_FAILED_MS);
      });
  };
  const failedNote = (field: keyof UiSettings) => (failed.includes(field) ? <SaveFailed /> : null);

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
  const coordinates = device.showCoordinates ? 'show' : 'hide';
  const lead = device.scoreWithKomi ? 'komi' : 'board';
  const leadOptions: Array<['komi' | 'board', string]> = [
    ['komi', t('settings.lead.withKomi')],
    ['board', t('settings.lead.board')],
  ];
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' });
  const coordinateOptions: Array<['show' | 'hide', string]> = [
    ['show', t('settings.coordinatesShow')],
    ['hide', t('settings.coordinatesHide')],
  ];
  const onTopOptions: Array<['on' | 'off', string]> = [
    ['on', t('settings.alwaysOnTop.on')],
    ['off', t('settings.alwaysOnTop.off')],
  ];
  const onTop = device.alwaysOnTop ? 'on' : 'off';
  const onOff: Array<['on' | 'off', string]> = [
    ['on', t('settings.analyseOnOpen.on')],
    ['off', t('settings.analyseOnOpen.off')],
  ];
  const onOpen = settings.analyseOnOpen ? 'on' : 'off';
  const writeAnalysis = settings.saveAnalysis ? 'on' : 'off';
  const nextMove = settings.showNextMove ? 'show' : 'hide';
  const nextMoveOptions: Array<['show' | 'hide', string]> = [
    ['show', t('settings.nextMove.show')],
    ['hide', t('settings.nextMove.hide')],
  ];

  /** Taking the other line's field swaps the two, so the lines stay different. */
  const setDiscLine = (index: 0 | 1, field: DiscField) => {
    const lines = [...device.discLines] as [DiscField, DiscField];
    const other = index === 0 ? 1 : 0;
    if (lines[other] === field) lines[other] = lines[index];
    lines[index] = field;
    updateDevice({ discLines: lines });
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <PanelTitle title={t('settings.title')} onBack={toMain} backLabel={t('settings.back')} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <Section title={t('settings.interface')}>
          <Row label={t('settings.language')} note={failedNote(FIELD.language)}>
            <Choice
              label={t('settings.language')}
              value={settings.language}
              disabled={!loaded}
              onChange={(language) => save({ language })}
              options={languageOptions}
            />
          </Row>
          <Row label={t('settings.theme')} note={failedNote(FIELD.theme)}>
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
              disabled={false}
              onChange={(choice) => updateDevice({ showCoordinates: choice === 'show' })}
              options={coordinateOptions}
            />
          </Row>
          <Row label={t('settings.scale')}>
            <Select
              value={String(device.interfaceScale)}
              onValueChange={(scale) =>
                updateDevice({ interfaceScale: Number(scale) as InterfaceScale })
              }
            >
              <SelectTrigger size="sm" className="w-28" aria-label={t('settings.scale')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERFACE_SCALES.map((scale) => (
                  <SelectItem key={scale} value={String(scale)}>
                    {percent.format(scale / 100)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t('settings.board.title')}>
            <BoardStyleControl />
          </Row>
          <LayoutSettings />
          {/* Its only place (owner, 2026-11-22): a window preference, not a game action. */}
          <Row label={t('settings.alwaysOnTop.title')}>
            <Choice
              label={t('settings.alwaysOnTop.title')}
              value={onTop}
              disabled={false}
              onChange={(choice) => updateDevice({ alwaysOnTop: choice === 'on' })}
              options={onTopOptions}
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
                    value={device.discLines[index]}
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
            <DiscPreview lines={device.discLines} />
          </div>
          {/* Off for guessing the next move: no ring, no 实战 and no disc give it away. */}
          <Row label={t('settings.nextMove.title')} note={failedNote(FIELD.showNextMove)}>
            <Choice
              label={t('settings.nextMove.title')}
              value={nextMove}
              disabled={!loaded}
              onChange={(choice) => save({ showNextMove: choice === 'show' })}
              options={nextMoveOptions}
            />
          </Row>
          <Row
            label={t('settings.analyseOnOpen.title')}
            sub={t('settings.analyseOnOpen.sub')}
            note={failedNote(FIELD.analyseOnOpen)}
          >
            <Choice
              label={t('settings.analyseOnOpen.title')}
              value={onOpen}
              disabled={!loaded}
              onChange={(choice) => save({ analyseOnOpen: choice === 'on' })}
              options={onOff}
            />
          </Row>
          <CacheRow
            transport={transport}
            capMb={settings.cacheCapMb}
            disabled={!loaded}
            onCap={(cacheCapMb) => save({ cacheCapMb })}
          />
          {failedNote(FIELD.cacheCapMb)}
          <Row
            label={t('settings.saveAnalysis.title')}
            sub={t('settings.saveAnalysis.sub')}
            note={failedNote(FIELD.saveAnalysis)}
          >
            <Choice
              label={t('settings.saveAnalysis.title')}
              value={writeAnalysis}
              disabled={!loaded}
              onChange={(choice) => save({ saveAnalysis: choice === 'on' })}
              options={onOff}
            />
          </Row>
          <Row label={t('settings.lead.title')}>
            <Choice
              label={t('settings.lead.title')}
              value={lead}
              disabled={false}
              onChange={(choice) => updateDevice({ scoreWithKomi: choice === 'komi' })}
              options={leadOptions}
            />
          </Row>
          <RulesControl
            layout={RULES_LAYOUT}
            ruleLabel={t('settings.defaultRules')}
            value={settings.defaultRules}
            onChange={(defaultRules) => save({ defaultRules })}
          />
          {failedNote(FIELD.defaultRules)}
          <p className="text-[0.75rem] text-text-muted">{t('settings.defaultRulesNote')}</p>
          <Row label={t('settings.visitLimit')} note={failedNote(FIELD.visitLimit)}>
            <VisitLimit
              value={settings.visitLimit}
              disabled={!loaded}
              onCommit={(visitLimit) => save({ visitLimit })}
            />
          </Row>
          <p className="text-[0.75rem] text-text-muted">{t('settings.visitLimitNote')}</p>
        </Section>

        <EngineSection transport={transport} />

        <button
          type="button"
          className="mt-4 flex w-full items-center px-6 py-3 text-left text-[0.875rem] hover:bg-divider-soft"
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
      <h3 className="mb-3 text-[0.75rem] text-text-muted">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** The saved settings whose controls can say a save failed. */
const FIELD = {
  language: 'language',
  theme: 'theme',
  defaultRules: 'defaultRules',
  visitLimit: 'visitLimit',
  showNextMove: 'showNextMove',
  analyseOnOpen: 'analyseOnOpen',
  cacheCapMb: 'cacheCapMb',
  saveAnalysis: 'saveAnalysis',
} as const satisfies Record<string, keyof UiSettings>;

/** How long 保存失败 stays beside a control. */
const SAVE_FAILED_MS = 3000;

function SaveFailed() {
  const { t } = useTranslation();
  return (
    <span role="status" className="text-[0.75rem] text-engine-error">
      {t('settings.saveFailed')}
    </span>
  );
}

function Row({
  label,
  sub,
  note,
  children,
}: {
  label: string;
  /** A line under the label saying what the setting does. */
  sub?: string;
  /** Said after the control: a failed save. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={SETTINGS_ROW}>
      {sub ? (
        <span className={SETTINGS_LABEL}>
          {label}
          <span className="mt-0.5 block text-[0.75rem] text-text-muted">{sub}</span>
        </span>
      ) : (
        <span className={SETTINGS_LABEL}>{label}</span>
      )}
      {children}
      {note}
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
      className="h-8 w-32 rounded-md border border-hairline bg-transparent px-2.5 text-[0.875rem] tabular-nums outline-none placeholder:text-text-muted focus-visible:border-text-muted"
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
      <div className="text-[0.875rem]">
        {active ? (
          <>
            <p>
              {t('settings.engineLine', {
                version: active.version,
                backend: backendName(t, active.backend),
              })}
            </p>
            <p className="mt-1 text-[0.8125rem] text-text-muted">
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
        <p role="alert" className="text-[0.8125rem] text-engine-error">
          {error}
        </p>
      )}
      {unused !== null && (
        <div className="flex items-center gap-3 text-[0.875rem]">
          <span className="flex-1">{t('settings.unused')}</span>
          <span className="text-[0.8125rem] text-text-muted tabular-nums">{unusedSize}</span>
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
