import { useMemo } from 'react';
import { useEngineStore } from '../engine/engineStore';
import { useDeviceStore } from '../device/deviceStore';
import { useGameStore } from '../game/gameStore';
import { useSettingsStore } from '../settings/settingsStore';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import { shownCandidates, type ShownCandidate } from './candidates';
import { useBoardKomi } from './lead';

export interface Shown {
  /** The analysis of the position on the board, or `null` (none yet, another key, illegal). */
  current: AnalysisUpdate | null;
  /**
   * The candidates the board and the table show (design 5.6), in the numbers of the side to move
   * (P2 M1 design 5.10), with the score option applied.
   */
  shown: ShownCandidate[];
}

const NONE: ShownCandidate[] = [];

/** The same candidate set for the discs and the table. */
export function useShownCandidates(): Shown {
  const analysis = useEngineStore((s) => s.analysis);
  const snapshot = useGameStore((s) => s.snapshot);
  const key = snapshot?.positionKey ?? null;
  const current = analysis && key !== null && analysis.position === key ? analysis : null;
  const toPlay = snapshot?.nextColor ?? 'black';
  // Off, the record's next move is not given away anywhere: no ring, no 实战, no disc (5.6).
  const showNext = useSettingsStore((s) => s.settings?.showNextMove ?? true);
  const nextMove = showNext ? (snapshot?.nextMove ?? null) : null;
  const boardKomi = useBoardKomi();
  const count = useDeviceStore((s) => s.settings.candidateCount);
  const shown = useMemo(
    () => (current ? shownCandidates(current, toPlay, nextMove, toPlay, boardKomi, count) : NONE),
    [current, toPlay, nextMove, boardKomi, count],
  );
  return { current, shown };
}
