import { useWindowSize } from '../layout/useWindowSize';
import { CandidateTable } from '../panel/CandidateTable';
import { TrendGraph } from '../panel/TrendGraph';
import { WinrateBar } from '../panel/WinrateBar';
import { COMPACT_WINDOW_HEIGHT, GRAPH_HEIGHT, GRAPH_HEIGHT_COMPACT } from './constants';
import { useAnalysisKeys } from './useAnalysisKeys';

/**
 * The analysis under the panel header (design 5.4–5.7): the win-rate bar, the trend graph with
 * its legend, and the candidate table. The layout stands before any status or result arrives,
 * and on an illegal node, so nothing jumps when the numbers come.
 */
export function AnalysisPanel() {
  useAnalysisKeys();
  const { height } = useWindowSize();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WinrateBar />
      <TrendGraph height={height < COMPACT_WINDOW_HEIGHT ? GRAPH_HEIGHT_COMPACT : GRAPH_HEIGHT} />
      <CandidateTable />
    </div>
  );
}
