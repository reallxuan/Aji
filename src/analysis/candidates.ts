import { boardLead } from './lead';
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
  /** 0–1, for the chosen perspective's side. */
  winrate: number;
  /** In points, for the chosen perspective's side. */
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

/** A stable key for a move, for React lists: a candidate keeps it however its rank moves. */
export function moveKey(move: Move): string {
  return move.type === 'pass' ? 'pass' : `${move.x},${move.y}`;
}

/**
 * KataGo's candidates by its order: at most ten, each with at least 2% of the top candidate's
 * visits, plus the move played next if KataGo reported it. Win rate and lead are `perspective`'s
 * (design 13.1); loss and tier rate each move for the side to move, whoever is watching.
 */
export function shownCandidates(
  update: AnalysisUpdate,
  toPlay: Color,
  nextMove: Move | null,
  perspective: Color,
  /** The komi to take out of the leads (the board count), or `null` for KataGo's lead. */
  boardKomi: number | null = null,
): ShownCandidate[] {
  const ordered = [...update.candidates].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return [];
  const threshold = ordered[0].visits * MIN_VISIT_SHARE;
  const picked = ordered.filter((c) => c.visits >= threshold).slice(0, MAX_CANDIDATES);
  const played = ordered.find((c) => sameMove(c.move, nextMove));
  if (played && !picked.includes(played)) picked.push(played);

  const forMover = (blackWinrate: number) => (toPlay === 'black' ? blackWinrate : 1 - blackWinrate);
  const best = forMover(picked[0].winrate);
  const black = perspective === 'black';
  const viewedLead = (lead: number) =>
    boardKomi === null ? lead : boardLead(lead, boardKomi, perspective);
  return picked.map((c, i) => {
    const loss = (best - forMover(c.winrate)) * 100;
    return {
      move: c.move,
      rank: i + 1,
      tier: tierFor(loss, i === 0),
      winrate: black ? c.winrate : 1 - c.winrate,
      scoreLead: viewedLead(black ? c.scoreLead : -c.scoreLead),
      visits: c.visits,
      loss,
      played: c === played,
      pv: c.pv,
    };
  });
}
