import { stopReplay } from '../game/replayStore';
import { useTranslation } from 'react-i18next';
import { Dialog } from 'radix-ui';
import { Sheet } from '../layout/Sheet';
import { PopoverContent } from '@/components/ui/popover';
import { useCallback } from 'react';
import { registerRecordEditor, usePendingField, writeRootField } from '../game/fieldWrites';
import type { InfoField } from '../transport/generated/InfoField';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import { DraftInput, type RegisterEditor } from './DraftInput';
import { ResultField, infoInputClass } from './ResultField';
import { useGameStore } from '../game/gameStore';
import { formatKomi, komiOf, scoringOf } from '../game/komi';
import { useActionContext } from '../game/useActionContext';
import { RulesControl } from '../settings/RulesControl';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { TFunction } from 'i18next';

function describe(rules: AnalysisRules, t: TFunction): string {
  if (rules.kind !== 'custom') return t(`rules.described.${rules.kind}`);
  return t('rules.described.custom', {
    scoring: t(`rules.${scoringOf(rules)}`),
    komi: formatKomi(komiOf(rules)),
  });
}

const Code = ({ children }: { children: string }) => (
  <code className="rounded-xs bg-divider-soft px-1 font-mono text-[0.71875rem] text-text">
    {children}
  </code>
);

/** What the file wrote and how Aji read it, with a way back to that reading. */
function RulesSource({ restoreReading }: { restoreReading(): void }) {
  const { t } = useTranslation();
  const rules = useGameStore((s) => s.snapshot?.rules);
  if (!rules) return null;
  const codes = [rules.ru && `RU[${rules.ru}]`, rules.km && `KM[${rules.km}]`].filter(
    (c): c is string => Boolean(c),
  );
  const restore = (
    <button
      type="button"
      className="ml-1 text-text underline decoration-line underline-offset-3 hover:decoration-text"
      onClick={restoreReading}
    >
      {t('rules.source.restore')}
    </button>
  );
  let text;
  if (codes.length === 0) {
    text = rules.changed ? t('rules.source.changedNone') : t('rules.source.none');
  } else {
    const lead = rules.changed ? t('rules.source.changedLead') : t('rules.source.sameLead');
    const tail = rules.changed ? 'rules.source.wasReadAs' : 'rules.source.readAs';
    text = (
      <>
        {lead}
        {codes.map((code) => (
          <span key={code}>
            {' '}
            <Code>{code}</Code>
          </span>
        ))}
        {t(tail, { rules: describe(rules.fromFile, t) })}
      </>
    );
  }
  return (
    <p data-testid="rules-source" className="mt-1 text-[0.75rem] leading-relaxed text-text-muted">
      {text}
      {rules.changed && restore}
    </p>
  );
}

function InfoEditor({
  field,
  snapshot,
  register,
}: {
  field: InfoField;
  snapshot: GameSnapshot;
  register: RegisterEditor;
}) {
  const ctx = useActionContext();
  const pending = usePendingField(ctx.transport, field);
  const value = pending ? pending.value : snapshot.info[field];
  const change = (next: string | null) =>
    void writeRootField(ctx, snapshot.gameRevision, { kind: 'setInfo', field, value: next });
  const label = ctx.t(`gameInfo.${field}`);
  if (field === 'result')
    return <ResultField value={value} onChange={change} register={register} />;
  return (
    <DraftInput
      aria-label={label}
      className={infoInputClass}
      value={value ?? ''}
      register={register}
      placeholder={ctx.t('gameInfo.unfilled')}
      onCommit={(text) => change(text || null)}
    />
  );
}

const PLAYERS = [
  ['black', 'blackRank'],
  ['white', 'whiteRank'],
] as const;
const RECORD_FIELDS = ['date', 'event', 'round', 'place', 'gameName'] as const;

function Form({ snapshot }: { snapshot: GameSnapshot }) {
  const ctx = useActionContext();
  const { t } = ctx;
  const register = useCallback(
    (finish: () => void) => registerRecordEditor(ctx.transport, finish),
    [ctx.transport],
  );
  const pending = usePendingField(ctx.transport, 'rules');
  const current = pending ? (pending.value ?? snapshot.rules.fromFile) : snapshot.rules.current;
  const selectRules = (rules: AnalysisRules | null) =>
    void writeRootField(ctx, snapshot.gameRevision, { kind: 'setRules', rules });
  const editor = (field: InfoField) => (
    <InfoEditor field={field} register={register} snapshot={snapshot} />
  );
  const result = editor('result');
  const labelClass = 'self-center text-xs text-text-muted';
  return (
    <fieldset
      onChangeCapture={stopReplay}
      disabled={snapshot.tryout !== null}
      className="min-w-0 text-sm disabled:opacity-65"
    >
      <section className="px-4 py-3.5">
        <h3 className="mb-3 font-medium">{t('gameInfo.title')}</h3>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(4rem,0.45fr)] gap-x-2 gap-y-1.5">
          {PLAYERS.map(([color, rank]) => (
            <div key={color} className="contents">
              <span className={labelClass}>{t(`gameInfo.${color}`)}</span>
              {editor(color)}
              {editor(rank)}
            </div>
          ))}
          <span className={labelClass}>{t('gameInfo.result')}</span>
          <div className="col-span-2">{result}</div>
          {RECORD_FIELDS.map((field) => (
            <div key={field} className="contents">
              <span className={labelClass}>{t(`gameInfo.${field}`)}</span>
              <div className="col-span-2 grid">{editor(field)}</div>
            </div>
          ))}
          {snapshot.info.handicap !== null && (
            <>
              <span className={labelClass}>{t('gameInfo.handicap')}</span>
              <span>{snapshot.info.handicap}</span>
            </>
          )}
        </div>
      </section>
      <section className="border-t border-hairline px-4 py-3.5">
        <h4 className="mb-2.5 text-xs font-medium text-text-muted">{t('rules.title')}</h4>
        <RulesControl value={current} onChange={selectRules} register={register} />
        <RulesSource restoreReading={() => selectRules(null)} />
      </section>
    </fieldset>
  );
}

export function GameInfoContent() {
  const snapshot = useGameStore((s) => s.snapshot);
  return snapshot ? <Form key={snapshot.gameRevision} snapshot={snapshot} /> : null;
}

function keepEditing(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement) event.preventDefault();
}

/** Both header entry points use the same form; the narrow frame gets the full-window sheet. */
export function GameInfoSurface({
  narrow,
  open,
  onClose,
}: {
  narrow: boolean;
  open: boolean;
  onClose(): void;
}) {
  const { t } = useTranslation();
  if (narrow)
    return (
      <Dialog.Root
        open={open}
        onOpenChange={(shown) => {
          if (!shown) onClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Content asChild aria-describedby={undefined} onEscapeKeyDown={keepEditing}>
            <Sheet onClose={onClose}>
              <Dialog.Title className="sr-only">{t('gameInfo.title')}</Dialog.Title>
              <GameInfoContent />
            </Sheet>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  return (
    <PopoverContent
      aria-label={t('gameInfo.title')}
      align="start"
      sideOffset={6}
      collisionPadding={12}
      onEscapeKeyDown={keepEditing}
      className="max-h-(--radix-popover-content-available-height) w-[min(26rem,calc(100vw-24px))] overflow-y-auto p-0"
    >
      <GameInfoContent />
    </PopoverContent>
  );
}
