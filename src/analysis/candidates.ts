import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { Color } from '../transport/generated/Color';
import type { Move } from '../transport/generated/Move';
import { CLOSE_LOSS, DOUBTFUL_LOSS, MAX_CANDIDATES, MIN_VISIT_SHARE } from './constants';

export type Tier = 'best' | 'close' | 'doubtful' | 'poor';

/** A candidate as the board and the table show it (design 5.6). */
export interface ShownCandidate {
  move: Move;
  /** 1-based over the shown set. */
  rank: number;
  tier: Tier;
  /** 0–1, for the side to move. */
  winrate: number;
  /** In points, for the side to move. */
  scoreLead: number;
  visits: number;
  /** The side to move's win-rate loss against the best, in percentage points. */
  loss: number;
  /** The move actually played next in the record. */
  played: boolean;
  pv: Move[];
}

/** True while a new search has fewer visits than the cached one it replaces (design 5.2). */
export function catchingUp(update: AnalysisUpdate): boolean {
  return update.rootVisits < update.previousVisits;
}

/** Under 2 points of loss is close, 2 to 4 inclusive is doubtful, over 4 is poor. */
export function tierFor(loss: number, isBest: boolean): Tier {
  if (isBest) return 'best';
  if (loss < CLOSE_LOSS) return 'close';
  if (loss <= DOUBTFUL_LOSS) return 'doubtful';
  return 'poor';
}

export function sameMove(a: Move | null, b: Move | null): boolean {
  if (!a || !b || a.type !== b.type) return false;
  return a.type === 'pass' || (b.type === 'play' && a.x === b.x && a.y === b.y);
}

/**
 * KataGo's candidates by its order: at most ten, each with at least 2% of the top candidate's
 * visits, plus the move played next if KataGo reported it. In the side to move's view.
 */
export function shownCandidates(
  update: AnalysisUpdate,
  toPlay: Color,
  nextMove: Move | null,
): ShownCandidate[] {
  const ordered = [...update.candidates].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return [];
  const threshold = ordered[0].visits * MIN_VISIT_SHARE;
  const picked = ordered.filter((c) => c.visits >= threshold).slice(0, MAX_CANDIDATES);
  const played = ordered.find((c) => sameMove(c.move, nextMove));
  if (played && !picked.includes(played)) picked.push(played);

  const forMover = (blackWinrate: number) => (toPlay === 'black' ? blackWinrate : 1 - blackWinrate);
  const best = forMover(picked[0].winrate);
  return picked.map((c, i) => {
    const winrate = forMover(c.winrate);
    const loss = (best - winrate) * 100;
    return {
      move: c.move,
      rank: i + 1,
      tier: tierFor(loss, i === 0),
      winrate,
      scoreLead: toPlay === 'black' ? c.scoreLead : -c.scoreLead,
      visits: c.visits,
      loss,
      played: c === played,
      pv: c.pv,
    };
  });
}
