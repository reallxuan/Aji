import { MinusIcon, PlusIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatKomi, komiOf, MAX_KOMI, parseKomi, scoringOf } from '../game/komi';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { Scoring } from '../transport/generated/Scoring';

type Kind = AnalysisRules['kind'];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-[13.5px]">
      <span className="w-9 flex-none text-text-muted">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange(value: T): void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value}
      // Clicking the chosen item again would clear it; the rules always have a value.
      onValueChange={(next) => next && next !== value && onChange(next as T)}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem key={option} value={option} className="px-3 whitespace-nowrap">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** − komi +: steps of 0.5 within ±150; a typed value is taken on Enter or blur if valid. */
function KomiStepper({ komi, onChange }: { komi: number; onChange(komi: number): void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(formatKomi(komi));
  // A komi changed from outside (a step, another client) replaces what is shown.
  const [shown, setShown] = useState(komi);
  if (shown !== komi) {
    setShown(komi);
    setText(formatKomi(komi));
  }
  const commit = () => {
    const typed = parseKomi(text);
    if (typed === null || typed === komi) setText(formatKomi(komi));
    else onChange(typed);
  };
  const step = (by: number) => onChange(Math.max(-MAX_KOMI, Math.min(MAX_KOMI, komi + by)));
  const button =
    'flex h-7 w-8 items-center justify-center text-text-muted hover:text-text disabled:opacity-35';
  return (
    <span className="inline-flex items-center rounded-md border border-hairline">
      <button
        type="button"
        className={button}
        aria-label={t('rules.komiDown')}
        disabled={komi <= -MAX_KOMI}
        onClick={() => step(-0.5)}
      >
        <MinusIcon className="size-3.5" aria-hidden />
      </button>
      <input
        aria-label={t('rules.komi')}
        inputMode="decimal"
        className="h-7 w-14 border-x border-hairline bg-transparent text-center font-medium tabular-nums outline-none focus:border-text focus:ring-2 focus:ring-text/20"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setText(formatKomi(komi));
        }}
      />
      <button
        type="button"
        className={button}
        aria-label={t('rules.komiUp')}
        disabled={komi >= MAX_KOMI}
        onClick={() => step(0.5)}
      >
        <PlusIcon className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/**
 * The analysis rules (design 5.5, mockup frame C): 中国规则 · 日韩规则 · 自定义. A preset fixes
 * its komi and scoring; Custom frees both, starting from the preset it leaves.
 */
export function RulesControl({
  value,
  onChange,
}: {
  value: AnalysisRules;
  onChange(rules: AnalysisRules): void;
}) {
  const { t } = useTranslation();
  const komi = komiOf(value);
  const scoring = scoringOf(value);
  const choose = (kind: Kind) =>
    onChange(kind === 'custom' ? { kind, komi, scoring } : ({ kind } as AnalysisRules));
  const scorings: Array<[Scoring, string]> = [
    ['area', t('rules.area')],
    ['territory', t('rules.territory')],
  ];
  const kinds: Array<[Kind, string]> = [
    ['chinese', t('rules.chinese')],
    ['japaneseKorean', t('rules.japaneseKorean')],
    ['custom', t('rules.custom')],
  ];
  return (
    <div className="flex flex-col gap-2.5">
      <Field label={t('rules.rule')}>
        <Segmented<Kind>
          label={t('rules.rule')}
          value={value.kind}
          options={kinds}
          onChange={choose}
        />
      </Field>
      <Field label={t('rules.komi')}>
        {value.kind === 'custom' ? (
          <>
            <KomiStepper komi={komi} onChange={(next) => onChange({ ...value, komi: next })} />
            <span className="text-[12px] text-text-muted">{t('rules.stepHint')}</span>
          </>
        ) : (
          <>
            <span className="font-medium">{t('rules.fixedKomi', { komi: formatKomi(komi) })}</span>
            <span className="text-[12px] text-text-muted">
              {t('rules.fixedHint', { scoring: t(`rules.${scoring}`) })}
            </span>
          </>
        )}
      </Field>
      {value.kind === 'custom' && (
        <Field label={t('rules.scoring')}>
          <Segmented<Scoring>
            label={t('rules.scoring')}
            value={scoring}
            options={scorings}
            onChange={(next) => onChange({ ...value, scoring: next })}
          />
        </Field>
      )}
    </div>
  );
}
