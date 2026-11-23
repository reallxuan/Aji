import { WinrateBar } from '../panel/WinrateBar';
import { ScoringCard } from './ScoringCard';
import { useScoringStore } from './scoringStore';

/** The win-rate bar's place: the bar, or the count while scoring (P2 M2 design 5.8). */
export function WinrateSlot() {
  const scoring = useScoringStore((s) => s.active);
  return scoring ? <ScoringCard /> : <WinrateBar />;
}
