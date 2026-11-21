import { useMemo } from 'react';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import { catchingUp, shownCandidates, type ShownCandidate } from './candidates';

export interface Shown {
  /** The analysis of the position on the board, or `null` (none yet, another key, illegal). */
  current: AnalysisUpdate | null;
  /** The candidates the board and the table show (design 5.6). */
  shown: ShownCandidate[];
  /** A new search is still below the cached depth (design 5.2). */
  fading: boolean;
}

const NONE: ShownCandidate[] = [];

/** The same candidate set for the discs and the table. */
export function useShownCandidates(): Shown {
  const analysis = useEngineStore((s) => s.analysis);
  const snapshot = useGameStore((s) => s.snapshot);
  const key = snapshot?.positionKey ?? null;
  const current = analysis && key !== null && analysis.position === key ? analysis : null;
  const toPlay = snapshot?.nextColor ?? 'black';
  const nextMove = snapshot?.nextMove ?? null;
  const shown = useMemo(
    () => (current ? shownCandidates(current, toPlay, nextMove) : NONE),
    [current, toPlay, nextMove],
  );
  return { current, shown, fading: current !== null && catchingUp(current) };
}
