import type { AnalysisRules } from '../transport/generated/AnalysisRules';
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

/** `7` for 7, `7.5` for 7.5, `-0.5` for -0.5. */
export const formatKomi = (komi: number) => String(komi);

/** A typed komi: a multiple of 0.5 within ±150, else `null`. */
export function parseKomi(text: string): number | null {
  const trimmed = text.trim().replace('−', '-');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const komi = Number(trimmed);
  if (!Number.isFinite(komi) || Math.abs(komi) > MAX_KOMI || (komi * 2) % 1 !== 0) return null;
  return komi === 0 ? 0 : komi;
}
