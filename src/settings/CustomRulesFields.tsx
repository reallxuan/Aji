import { useTranslation } from 'react-i18next';
import { detailsOf } from '../game/komi';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { RuleDetails } from '../transport/generated/RuleDetails';
import { Field, Segmented, type Layout } from './RuleField';

const choices = {
  ko: ['simple', 'positional', 'situational'],
  suicide: ['off', 'on'],
  tax: ['none', 'seki', 'all'],
  whiteHandicapBonus: ['zero', 'nMinusOne', 'n'],
  hasButton: ['off', 'on'],
} as const;

export function CustomRulesFields({
  value,
  layout,
  onChange,
}: {
  value: Extract<AnalysisRules, { kind: 'custom' }>;
  layout: Layout;
  onChange(rules: AnalysisRules): void;
}) {
  const { t } = useTranslation();
  const details = detailsOf(value);
  const scorings: Array<['area' | 'territory', string]> = [
    ['area', t('rules.area')],
    ['territory', t('rules.territory')],
  ];
  function row(key: keyof typeof choices) {
    const current = details[key];
    const selected = typeof current === 'boolean' ? (current ? 'on' : 'off') : current;
    const label = t(`rules.fields.${key}`);
    return (
      <Field key={key} layout={layout} label={label}>
        <Segmented
          label={label}
          value={selected}
          options={choices[key].map((v) => [v, t(`rules.options.${key}.${v}`)])}
          onChange={(next) => {
            const updated: RuleDetails = {
              ...details,
              [key]: typeof current === 'boolean' ? next === 'on' : next,
            };
            onChange({ ...value, details: updated });
          }}
        />
      </Field>
    );
  }
  return (
    <>
      <Field label={t('rules.scoring')} layout={layout}>
        <Segmented
          label={t('rules.scoring')}
          value={value.scoring}
          options={scorings}
          onChange={(scoring: 'area' | 'territory') => onChange({ ...value, scoring, details })}
        />
      </Field>
      {(Object.keys(choices) as Array<keyof typeof choices>).map(row)}
    </>
  );
}
