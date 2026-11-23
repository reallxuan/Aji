import type { ShownCandidate } from './candidates';

/** What the candidate list is sorted by (P2 M2 design 5.5); `rank` is KataGo's order. */
export type CandidateSortKey = 'rank' | 'winrate' | 'scoreLead' | 'visits';

export interface CandidateSort {
  key: CandidateSortKey;
  descending: boolean;
}

export const KATAGO_ORDER: CandidateSort = { key: 'rank', descending: true };

/**
 * `rows` sorted by `key`, high to low when `descending`; ties keep KataGo's order. `rank` is
 * KataGo's order whatever `descending` says. The rows keep their ranks, so a chip always matches
 * its disc on the board.
 */
export function sortCandidates(
  rows: readonly ShownCandidate[],
  key: CandidateSortKey,
  descending: boolean,
): ShownCandidate[] {
  const byRank = (a: ShownCandidate, b: ShownCandidate) => a.rank - b.rank;
  if (key === 'rank') return [...rows].sort(byRank);
  const sign = descending ? -1 : 1;
  return [...rows].sort((a, b) => sign * (a[key] - b[key]) || byRank(a, b));
}

/** A click on `column`'s header: high to low, then low to high, then KataGo's order again. */
export function nextSort(
  sort: CandidateSort,
  column: Exclude<CandidateSortKey, 'rank'>,
): CandidateSort {
  if (sort.key !== column) return { key: column, descending: true };
  return sort.descending ? { key: column, descending: false } : KATAGO_ORDER;
}
