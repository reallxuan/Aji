import type { TFunction } from 'i18next';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { RuleDetails } from '../transport/generated/RuleDetails';
import type { Scoring } from '../transport/generated/Scoring';

/** The largest komi either way (design 5.5). */
export const MAX_KOMI = 150;

/** The komi the rules analyse with. */
export function komiOf(rules: AnalysisRules): number {
  if (rules.kind === 'chinese') return 7.5;
  if (rules.kind === 'japaneseKorean') return 6.5;
  return rules.komi;
}

export function scoringOf(rules: AnalysisRules): Scoring {
  if (rules.kind === 'chinese') return 'area';
  if (rules.kind === 'japaneseKorean') return 'territory';
  return rules.scoring;
}

const baseDetails: Record<Scoring, RuleDetails> = {
  area: {
    ko: 'simple',
    tax: 'none',
    suicide: false,
    hasButton: false,
    whiteHandicapBonus: 'n',
    friendlyPassOk: true,
  },
  territory: {
    ko: 'simple',
    tax: 'seki',
    suicide: false,
    hasButton: false,
    whiteHandicapBonus: 'zero',
    friendlyPassOk: false,
  },
};

export function detailsOf(rules: AnalysisRules): RuleDetails {
  return (rules.kind === 'custom' && rules.details) || baseDetails[scoringOf(rules)];
}

export function sameRulesEffect(left: AnalysisRules, right: AnalysisRules): boolean {
  if (komiOf(left) !== komiOf(right) || scoringOf(left) !== scoringOf(right)) return false;
  const a = detailsOf(left);
  const b = detailsOf(right);
  return (
    a.ko === b.ko &&
    a.tax === b.tax &&
    a.suicide === b.suicide &&
    a.hasButton === b.hasButton &&
    a.whiteHandicapBonus === b.whiteHandicapBonus &&
    a.friendlyPassOk === b.friendlyPassOk
  );
}

/** `7` for 7, `7.5` for 7.5, `-0.5` for -0.5. */
export const formatKomi = (komi: number) => String(komi);

export function describeRules(rules: AnalysisRules, t: TFunction): string {
  if (rules.kind !== 'custom') return t(`rules.described.${rules.kind}`);
  return t('rules.described.custom', {
    scoring: t(`rules.${scoringOf(rules)}`),
    komi: formatKomi(komiOf(rules)),
  });
}

/** A typed komi: a multiple of 0.5 within ±150, else `null`. */
export function parseKomi(text: string): number | null {
  const trimmed = text.trim().replace('−', '-');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const komi = Number(trimmed);
  if (!Number.isFinite(komi) || Math.abs(komi) > MAX_KOMI || (komi * 2) % 1 !== 0) return null;
  return komi === 0 ? 0 : komi;
}
