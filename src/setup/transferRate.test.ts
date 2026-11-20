import { describe, expect, it } from 'vitest';
import { addSample, timeLeft, transferRate, type Sample } from './transferRate';

const MiB = 1024 * 1024;

function feed(points: Array<[number, number]>): Sample[] {
  return points.reduce<Sample[]>((samples, [at, done]) => addSample(samples, { at, done }), []);
}

describe('transferRate', () => {
  it('has no rate until the samples span a second', () => {
    expect(transferRate(feed([]))).toBeNull();
    expect(transferRate(feed([[0, 0]]))).toBeNull();
    expect(
      transferRate(
        feed([
          [0, 0],
          [900, MiB],
        ]),
      ),
    ).toBeNull();
  });

  it('is bytes per second across the samples', () => {
    const samples = feed([
      [0, 0],
      [1000, MiB],
      [2000, 3 * MiB],
    ]);
    expect(transferRate(samples)).toBe(1.5 * MiB);
  });

  it('follows the last three seconds, not the whole download', () => {
    // Fast for the first seconds, then 1 MiB/s.
    const samples = feed([
      [0, 0],
      [1000, 10 * MiB],
      [2000, 20 * MiB],
      [3000, 21 * MiB],
      [4000, 22 * MiB],
      [5000, 23 * MiB],
      [6000, 24 * MiB],
    ]);
    expect(transferRate(samples)).toBe(MiB);
  });

  it('starts again when the count goes back, as when a new download begins', () => {
    const samples = feed([
      [0, 50 * MiB],
      [1000, 60 * MiB],
      [2000, 0],
    ]);
    expect(samples).toEqual([{ at: 2000, done: 0 }]);
    expect(transferRate(samples)).toBeNull();
  });
});

describe('timeLeft', () => {
  it('is seconds under a minute, never zero', () => {
    expect(timeLeft(45.2)).toEqual({ unit: 'seconds', n: 46 });
    expect(timeLeft(0.1)).toEqual({ unit: 'seconds', n: 1 });
  });

  it('is whole minutes, rounded up, under an hour', () => {
    expect(timeLeft(60)).toEqual({ unit: 'minutes', n: 1 });
    expect(timeLeft(198)).toEqual({ unit: 'minutes', n: 4 });
    expect(timeLeft(3599)).toEqual({ unit: 'minutes', n: 60 });
  });

  it('is hours and minutes from an hour on', () => {
    expect(timeLeft(3600)).toEqual({ unit: 'hours', hours: 1, minutes: 0 });
    expect(timeLeft(2 * 3600 + 61)).toEqual({ unit: 'hours', hours: 2, minutes: 2 });
  });
});
