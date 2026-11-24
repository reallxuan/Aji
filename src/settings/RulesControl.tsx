import { MinusIcon, PlusIcon } from 'lucide-react';
import { Field, Segmented, type Layout } from './RuleField';
import { DECIMAL_INPUT_MODE, DraftInput, type RegisterEditor } from '../panel/DraftInput';
import { CustomRulesFields } from './CustomRulesFields';
import { useTranslation } from 'react-i18next';
import { detailsOf, formatKomi, komiOf, MAX_KOMI, parseKomi, scoringOf } from '../game/komi';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';

type Kind = AnalysisRules['kind'];

/** − komi +: steps of 0.5 within ±150; a typed value is taken on Enter or blur if valid. */
function KomiStepper({
  komi,
  onChange,
  register,
}: {
  komi: number;
  onChange(komi: number): void;
  register?: RegisterEditor;
}) {
  const { t } = useTranslation();
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
      <DraftInput
        aria-label={t('rules.komi')}
        inputMode={DECIMAL_INPUT_MODE}
        className="h-7 w-14 border-x border-hairline bg-transparent text-center font-medium tabular-nums outline-none focus:border-text focus:ring-2 focus:ring-text/20"
        value={formatKomi(komi)}
        register={register}
        onCommit={(text) => {
          const typed = parseKomi(text);
          if (typed !== null && typed !== komi) onChange(typed);
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
 * The analysis rules (design 5.5, mockup frame C): 中国规则, 日韩规则, 自定义. A preset fixes
 * its komi and scoring; Custom frees both, starting from the preset it leaves.
 */
export function RulesControl({
  value,
  onChange,
  layout = 'popover',
  ruleLabel,
  register,
}: {
  value: AnalysisRules;
  onChange(rules: AnalysisRules): void;
  layout?: Layout;
  /** The first row's label; 规则 by default. */
  ruleLabel?: string;
  register?: RegisterEditor;
}) {
  const { t } = useTranslation();
  const komi = komiOf(value);
  const scoring = scoringOf(value);
  const choose = (kind: Kind) =>
    onChange(
      kind === 'custom'
        ? { kind, komi, scoring, details: detailsOf(value) }
        : ({ kind } as AnalysisRules),
    );
  const kinds: Array<[Kind, string]> = [
    ['chinese', t('rules.chinese')],
    ['japaneseKorean', t('rules.japaneseKorean')],
    ['custom', t('rules.custom')],
  ];
  return (
    <div className="flex flex-col gap-2.5">
      <Field label={ruleLabel ?? t('rules.rule')} layout={layout}>
        <Segmented<Kind>
          label={ruleLabel ?? t('rules.rule')}
          value={value.kind}
          options={kinds}
          onChange={choose}
        />
      </Field>
      <Field label={t('rules.komi')} layout={layout}>
        {value.kind === 'custom' ? (
          <>
            <KomiStepper
              register={register}
              komi={komi}
              onChange={(next) => onChange({ ...value, komi: next, details: detailsOf(value) })}
            />
            <span className="text-[0.75rem] text-text-muted">{t('rules.stepHint')}</span>
          </>
        ) : (
          <>
            <span className="font-medium">{t('rules.fixedKomi', { komi: formatKomi(komi) })}</span>
            <span className="text-[0.75rem] text-text-muted">
              {t('rules.fixedHint', { scoring: t(`rules.${scoring}`) })}
            </span>
          </>
        )}
      </Field>
      {value.kind === 'custom' && (
        <CustomRulesFields value={value} layout={layout} onChange={onChange} />
      )}
    </div>
  );
}
