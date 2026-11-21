import type { TrendNode } from '../transport/generated/TrendNode';
import { SCORE_RANGES, TREND_MIN_VISITS } from './constants';

/** A node is plotted once its stats have enough visits to mean something (design 5.5). */
export function plotted(node: TrendNode | undefined): boolean {
  return !!node?.stats && node.stats.visits >= TREND_MIN_VISITS;
}

/** Runs of consecutive plotted node indices: each is drawn as one line, and a gap breaks it. */
export function plotRuns(nodes: readonly TrendNode[]): number[][] {
  const runs: number[][] = [];
  let run: number[] | null = null;
  nodes.forEach((node, i) => {
    if (!plotted(node)) {
      run = null;
      return;
    }
    if (!run) runs.push((run = []));
    run.push(i);
  });
  return runs;
}

/** The first of ±10, ±20, ±40, ±80, ±160 points that holds every plotted lead. */
export function scoreRange(nodes: readonly TrendNode[]): number {
  const most = nodes.reduce(
    (max, node) => (plotted(node) ? Math.max(max, Math.abs(node.stats!.scoreLead)) : max),
    0,
  );
  return SCORE_RANGES.find((range) => most <= range) ?? SCORE_RANGES[SCORE_RANGES.length - 1];
}

/** The bar's text padding: left and right of a segment, and between its two texts. */
const BAR_PADDING = 9;

/**
 * The texts in each segment of the win-rate bar, left to right (design 5.4): each side's
 * percentage in its own segment, and the lead in the leader's beside it, when the segment holds
 * both with padding. A lead that rounds to 0.0 is not shown; neither is a percentage its segment
 * cannot hold.
 */
export function barTexts(
  blackWinrate: number,
  lead: number,
  segmentPx: { black: number; white: number },
  measure: (text: string) => number,
  labels: { percent(x: number): string; lead(points: number): string },
): { black: string[]; white: string[] } {
  const percent = { black: labels.percent(blackWinrate), white: labels.percent(1 - blackWinrate) };
  const fits = (texts: string[], width: number) =>
    texts.reduce((sum, t) => sum + measure(t), 0) + (texts.length + 1) * BAR_PADDING <= width;
  const side = (color: 'black' | 'white') =>
    fits([percent[color]], segmentPx[color]) ? [percent[color]] : [];
  const texts = { black: side('black'), white: side('white') };

  const points = Math.round(Math.abs(lead) * 10) / 10;
  if (points === 0) return texts;
  const leader = lead > 0 ? 'black' : 'white';
  const leadText = labels.lead(points);
  if (!fits([percent[leader], leadText], segmentPx[leader])) return texts;
  texts[leader] = leader === 'black' ? [percent.black, leadText] : [leadText, percent.white];
  return texts;
}
