/** A download's progress at one moment: milliseconds and bytes so far. */
export type Sample = { at: number; done: number };

/** The speed is averaged over this long, so it does not jump with each 250 ms snapshot. */
const WINDOW_MS = 3000;
/** No speed is shown before the samples span this long. */
const MIN_SPAN_MS = 1000;

/**
 * Adds a sample, keeping the newest ones that cover the window plus one just before it. A count
 * that goes back (a new download in the same row) starts the samples again.
 */
export function addSample(samples: Sample[], sample: Sample): Sample[] {
  const last = samples.at(-1);
  if (last && sample.done < last.done) return [sample];
  const next = [...samples, sample];
  while (next.length > 1 && next[1].at <= sample.at - WINDOW_MS) next.shift();
  return next;
}

/** Bytes per second across the samples, or `null` until they span a second. */
export function transferRate(samples: Sample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = last.at - first.at;
  if (span < MIN_SPAN_MS) return null;
  return ((last.done - first.done) * 1000) / span;
}

/** How long the rest takes, in the unit the interface shows: seconds, minutes, or both hours and minutes. */
export type TimeLeft =
  | { unit: 'seconds'; n: number }
  | { unit: 'minutes'; n: number }
  | { unit: 'hours'; hours: number; minutes: number };

/** Seconds left, rounded up: seconds under a minute, minutes under an hour, then hours and minutes. */
export function timeLeft(seconds: number): TimeLeft {
  if (seconds < 60) return { unit: 'seconds', n: Math.max(1, Math.ceil(seconds)) };
  if (seconds < 3600) return { unit: 'minutes', n: Math.ceil(seconds / 60) };
  const minutes = Math.ceil(seconds / 60);
  return { unit: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
