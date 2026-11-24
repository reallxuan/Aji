import type { AppEvent } from '../transport/generated/AppEvent';
import type { JobOptions } from '../transport/generated/JobOptions';
import type { JobProgress } from '../transport/generated/JobProgress';
import type { Loss } from '../transport/generated/Loss';
import type { TrendStats } from '../transport/generated/TrendStats';

export interface FakeResult {
  stats: TrendStats;
  loss: Loss | null;
}

/** Black's made-up win rate at line index `i`: a slow wave, with a collapse and a comeback. */
function winrate(i: number): number {
  const w = 0.5 + 0.18 * Math.sin(i / 13) + (i >= 80 ? -0.2 : 0) + (i >= 150 ? 0.28 : 0);
  return Math.min(0.97, Math.max(0.03, w));
}

const lead = (w: number) => Math.round((w - 0.5) * 400) / 10;

/** The made-up result at line index `i`, and its move's loss for the mover (odd: Black). */
export function fakeResult(i: number, visits: number): FakeResult {
  const w = winrate(i);
  const stats = { winrate: w, scoreLead: lead(w), visits };
  if (i === 0) return { stats, loss: null };
  const sign = i % 2 ? 1 : -1;
  const before = winrate(i - 1);
  return {
    stats,
    loss: { winrate: sign * (before - w) * 100, score: sign * (lead(before) - lead(w)) },
  };
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
  keys,
  options,
  revision,
  stepMs,
  emit,
  onResult,
}: {
  keys: (string | null)[];
  options: JobOptions;
  revision: number;
  stepMs: number;
  emit: (event: AppEvent) => void;
  onResult: (lineIndex: number, result: FakeResult) => void;
}): FakeJob {
  const count = keys.length;
  const [from, to] =
    options.range.kind === 'whole' ? [0, count - 1] : [options.range.from - 1, options.range.to];
  const inRange = (i: number) => i >= from && i <= Math.min(to, count - 1);
  // Black is to move at even indexes.
  const sideOk = (i: number) =>
    options.side === 'both' || (options.side === 'black') === (i % 2 === 0);
  const first = [...Array(count).keys()].filter((i) => keys[i] !== null && inRange(i) && sideOk(i));
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
    emit({ type: 'trendNodes', revision, nodes: [{ lineIndex: i, ...result }] });
    at++;
    if (at < queue.length) {
      emit({ type: 'jobProgress', progress: progress(pass === 'first' ? 'running' : 'boosting') });
      timer = setTimeout(step, stepMs);
      return;
    }
    if (pass === 'first' && options.boost.on) {
      const swings = first.filter(
        (i) => i > 0 && Math.abs(fakeResult(i, 0).loss!.winrate) >= options.boost.threshold,
      );
      boost = [...new Set(swings.flatMap((i) => [i - 1, i]))].sort((a, b) => a - b);
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
