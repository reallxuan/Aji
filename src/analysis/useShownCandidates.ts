import { useMemo } from 'react';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import { catchingUp, shownCandidates, type ShownCandidate } from './candidates';
import { useBoardKomi } from './lead';

export interface Shown {
  /** The analysis of the position on the board, or `null` (none yet, another key, illegal). */
  current: AnalysisUpdate | null;
  /**
   * The candidates the board and the table show (design 5.6), in the numbers of the side to move
   * (P2 M1 design 5.10), with the score option applied.
   */
  shown: ShownCandidate[];
  /** A running search is still below the cached depth (design 5.2). */
  fading: boolean;
}

const NONE: ShownCandidate[] = [];

/** The same candidate set for the discs and the table. */
export function useShownCandidates(): Shown {
  const analysis = useEngineStore((s) => s.analysis);
  const analysing = useEngineStore((s) => s.engine?.state === 'analysing');
  const snapshot = useGameStore((s) => s.snapshot);
  const key = snapshot?.positionKey ?? null;
  const current = analysis && key !== null && analysis.position === key ? analysis : null;
  const toPlay = snapshot?.nextColor ?? 'black';
  const nextMove = snapshot?.nextMove ?? null;
  const boardKomi = useBoardKomi();
  const shown = useMemo(
    () => (current ? shownCandidates(current, toPlay, nextMove, toPlay, boardKomi) : NONE),
    [current, toPlay, nextMove, boardKomi],
  );
  // Only a running search catches up: paused or restarting, its count is just what it reached.
  return { current, shown, fading: analysing && current !== null && catchingUp(current) };
}
