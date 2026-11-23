import type { Layout } from '../layout/model';
import { hidePanel, selectTab, showPanel } from '../layout/ops';

const WINRATE = { kind: 'winrate' } as const;

/**
 * The layout drawn while scoring (P2 M2 design 5.8): the count stands where the win-rate bar is,
 * shown and in front even if the user hid it or tabbed it away, and the graph steps aside. Only
 * drawn, never stored: leaving scoring brings the user's layout back as it was.
 */
export function scoringLayout(layout: Layout): Layout {
  return selectTab(showPanel(hidePanel(layout, { kind: 'trend' }), WINRATE), WINRATE);
}
