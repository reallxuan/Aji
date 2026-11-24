import type { AppEvent } from '../transport/generated/AppEvent';
import type { JobOptions } from '../transport/generated/JobOptions';
import type { JobProgress } from '../transport/generated/JobProgress';
import type { TrendNode } from '../transport/generated/TrendNode';
import type { TrendStats } from '../transport/generated/TrendStats';

/** Black's made-up win rate at line index `i`: a slow wave, with a collapse and a comeback. */
function winrate(i: number): number {
  const w = 0.5 + 0.18 * Math.sin(i / 13) + (i >= 80 ? -0.2 : 0) + (i >= 150 ? 0.28 : 0);
  return Math.min(0.97, Math.max(0.03, w));
}

const lead = (w: number) => Math.round((w - 0.5) * 400) / 10;

/** The made-up result at one main-line index. Losses are derived from available results. */
export function fakeResult(i: number, visits: number): TrendStats {
  const w = winrate(i);
  return { winrate: w, scoreLead: lead(w), visits };
}

export interface FakeJob {
  stop(): void;
}

/**
 * Plays a whole-game job over `count` main-line nodes: one position every `stepMs`, a trend
 * node and a progress event each, then the boost pass over the big swings, then done.
 * `onResult` hears every result, for the scenario's trend.
 */
export function playFakeJob({
  nodes,
  options,
  stepMs,
  emit,
  onResult,
}: {
  nodes: TrendNode[];
  options: JobOptions;
  stepMs: number;
  emit: (event: AppEvent) => void;
  onResult: (lineIndex: number, result: TrendStats) => void;
}): FakeJob {
  const keys = nodes.map((n) => n.key);
  const count = keys.length;
  const [from, to] =
    options.range.kind === 'whole' ? [0, count - 1] : [options.range.from - 1, options.range.to];
  const inRange = (i: number) => nodes[i].moveNumber >= from && nodes[i].moveNumber <= to;
  const sideOk = (i: number) => options.side === 'both' || options.side === nodes[i].toPlay;
  const seen = new Set<string>();
  const first = nodes.flatMap((node, i) => {
    if (!node.key || node.tryout || !inRange(i) || !sideOk(i) || seen.has(node.key)) return [];
    seen.add(node.key);
    return [i];
  });
  let boost: number[] = [];
  let pass: 'first' | 'boost' = 'first';
  let at = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const progress = (state: JobProgress['state']): JobProgress => {
    const queue = pass === 'first' ? first : boost;
    const left = queue.length - at;
    return {
      state,
      done: pass === 'first' ? at : first.length,
      total: first.length,
      boostDone: pass === 'boost' ? at : 0,
      boostTotal: boost.length,
      working: keys[queue[at]] ?? null,
      queued: queue.slice(at + 1).flatMap((i) => keys[i] ?? []),
      etaSeconds: state === 'done' ? null : Math.round((left * stepMs) / 1000),
    };
  };

  const step = () => {
    const queue = pass === 'first' ? first : boost;
    const visits = pass === 'first' ? options.visits : options.boost.visits;
    const i = queue[at];
    const result = fakeResult(i, visits);
    onResult(i, result);
    at++;
    if (at < queue.length) {
      emit({ type: 'jobProgress', progress: progress(pass === 'first' ? 'running' : 'boosting') });
      timer = setTimeout(step, stepMs);
      return;
    }
    if (pass === 'first' && options.boost.on) {
      const swings = first.filter(
        (i) =>
          i > 0 &&
          nodes[i].mover !== null &&
          Math.abs(winrate(i) - winrate(i - 1)) * 100 >= options.boost.threshold,
      );
      boost = [...new Set(swings.flatMap((i) => [i - 1, i]))]
        .filter((i) => keys[i] !== null && !nodes[i].tryout)
        .sort((a, b) => a - b);
      if (boost.length > 0) {
        pass = 'boost';
        at = 0;
        emit({ type: 'jobProgress', progress: progress('boosting') });
        timer = setTimeout(step, stepMs);
        return;
      }
    }
    timer = null;
    emit({ type: 'jobProgress', progress: { ...progress('done'), boostDone: boost.length } });
  };

  emit({ type: 'jobProgress', progress: progress('running') });
  timer = first.length > 0 ? setTimeout(step, stepMs) : null;
  if (!timer) emit({ type: 'jobProgress', progress: progress('done') });
  return {
    stop() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      emit({
        type: 'jobProgress',
        progress: { ...progress('stopped'), working: null, queued: [], etaSeconds: null },
      });
    },
  };
}
