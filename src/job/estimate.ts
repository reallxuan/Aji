import type { JobOptions } from '../transport/generated/JobOptions';
import type { TrendNode } from '../transport/generated/TrendNode';

/** The panel's choices before any are remembered (P2 M2 design 5.3). */
export const DEFAULT_JOB_OPTIONS: JobOptions = {
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
 * What a job with `options` would do over the trend's main line, as the backend plans it: one
 * search per position (a comment node repeats its parent's), between the positions before move
 * `from` and after move `to`, where the chosen side is to move. A setup stone or a handicap is not
 * known here, so Black is taken to move first.
 */
export function jobEstimate(
  nodes: TrendNode[],
  options: JobOptions,
  speed: number | null,
): JobEstimate {
  const seen = new Set<number>();
  let positions = 0;
  let cached = 0;
  for (const node of nodes) {
    if (seen.has(node.moveNumber)) continue;
    seen.add(node.moveNumber);
    const { range } = options;
    if (range.kind === 'moves' && (node.moveNumber < range.from - 1 || node.moveNumber > range.to))
      continue;
    const toMove = node.mover === 'black' ? 'white' : 'black';
    if (options.side !== 'both' && options.side !== toMove) continue;
    if (node.stats && node.stats.visits >= options.visits) cached++;
    else positions++;
  }
  return {
    positions,
    cached,
    seconds: speed && speed > 0 ? (positions * options.visits) / speed : null,
  };
}
