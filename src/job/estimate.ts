import type { JobOptions } from '../transport/generated/JobOptions';
import type { TrendNode } from '../transport/generated/TrendNode';

/** The panel's choices before any are remembered (P2 M2 design 5.3). */
export const DEFAULT_JOB_OPTIONS: JobOptions = {
  scope: 'line',
  range: { kind: 'whole' },
  side: 'both',
  visits: 500,
  boost: { on: true, threshold: 10, visits: 3000 },
};

export interface JobEstimate {
  /** Positions the first pass will search. */
  positions: number;
  /** Positions in range whose result already has the visits, which it skips. */
  cached: number;
  /** The first pass at `speed` visits a second; `null` when the speed is not known. */
  seconds: number | null;
}

/**
 * What a job with `options` would do over the selected line, as the backend plans it: one
 * search per position (a comment node repeats its parent's), between the positions before move
 * `from` and after move `to`, where the chosen side is to move. The service supplies the replayed side even on setup nodes and comments.
 */
export function jobEstimate(
  nodes: TrendNode[],
  options: JobOptions,
  speed: number | null,
): JobEstimate {
  const seen = new Set<string>();
  let positions = 0;
  let cached = 0;
  for (const node of nodes) {
    const { range } = options;
    if (range.kind === 'moves' && (node.moveNumber < range.from - 1 || node.moveNumber > range.to))
      continue;
    if (node.tryout || (options.side !== 'both' && options.side !== node.toPlay)) continue;
    if (node.key === null || seen.has(node.key)) continue;
    seen.add(node.key);
    if (node.stats && node.stats.visits >= options.visits) cached++;
    else positions++;
  }
  return {
    positions,
    cached,
    seconds: speed && speed > 0 ? (positions * options.visits) / speed : null,
  };
}
