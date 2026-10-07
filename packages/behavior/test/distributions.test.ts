import { ValidationError } from '@persona/core';
import { describe, expect, it } from 'vitest';

import {
  createSeededRandom,
  DEFAULT_ACTION_DELAY,
  DEFAULT_VIEW_DELAY,
  sampleLognormalDelayMs,
  type RandomFn,
} from '../src/index.js';

/** Replays the given values, then repeats the last one. */
function sequence(...values: number[]): RandomFn {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

const SEEDS = Array.from({ length: 200 }, (_, index) => index + 1);

describe('sampleLognormalDelayMs', () => {
  it.each([
    ['view delays', DEFAULT_VIEW_DELAY],
    ['action delays', DEFAULT_ACTION_DELAY],
  ])('stays within the bounds of the default %s', (_label, bounds) => {
    for (const seed of SEEDS) {
      const rng = createSeededRandom(seed);
      for (let draw = 0; draw < 20; draw += 1) {
        const value = sampleLognormalDelayMs({ rng, ...bounds });

        expect(value).toBeGreaterThanOrEqual(bounds.minMs);
        expect(value).toBeLessThanOrEqual(bounds.maxMs);
      }
    }
  });

  it('always returns a whole number of milliseconds', () => {
    const rng = createSeededRandom(99);
    for (let draw = 0; draw < 500; draw += 1) {
      expect(Number.isInteger(sampleLognormalDelayMs({ rng, ...DEFAULT_VIEW_DELAY }))).toBe(true);
    }
  });

  it('returns whole milliseconds even for fractional bounds', () => {
    const rng = createSeededRandom(5);
    for (let draw = 0; draw < 200; draw += 1) {
      const value = sampleLognormalDelayMs({
        rng,
        medianMs: 10.4,
        minMs: 5.2,
        maxMs: 20.7,
        sigma: 1,
      });

      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(5.2);
      expect(value).toBeLessThanOrEqual(20.7);
    }
  });

  it('is stable for a fixed rng', () => {
    const draw = () => sampleLognormalDelayMs({ rng: sequence(0.5, 0.5), ...DEFAULT_VIEW_DELAY });

    // u1 = u2 = 0.5 gives a standard normal value of -sqrt(2 ln 2); sigma defaults to 0.5.
    expect(draw()).toBe(Math.round(4000 * Math.exp(0.5 * -Math.sqrt(2 * Math.LN2))));
    expect(draw()).toBe(draw());
  });

  it('produces the same series for the same seed and a different one for another seed', () => {
    const series = (seed: number) => {
      const rng = createSeededRandom(seed);
      return Array.from({ length: 20 }, () =>
        sampleLognormalDelayMs({ rng, ...DEFAULT_ACTION_DELAY }),
      );
    };

    expect(series(11)).toEqual(series(11));
    expect(series(11)).not.toEqual(series(12));
  });

  it('centres on the requested median', () => {
    const rng = createSeededRandom(2024);
    const samples = Array.from({ length: 2000 }, () =>
      sampleLognormalDelayMs({ rng, medianMs: 4000, minMs: 1, maxMs: 1_000_000 }),
    ).sort((a, b) => a - b);

    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    expect(median).toBeGreaterThan(3600);
    expect(median).toBeLessThan(4400);
  });

  it('returns the median when sigma is 0', () => {
    expect(
      sampleLognormalDelayMs({
        rng: sequence(0.3, 0.8),
        medianMs: 4000,
        minMs: 1,
        maxMs: 9999,
        sigma: 0,
      }),
    ).toBe(4000);
  });

  it('clamps extreme draws to the bounds', () => {
    const bounds = { medianMs: 4000, minMs: 1500, maxMs: 45_000 };

    // A tiny u1 gives a very large |normal|; u2 = 0 makes it positive, u2 = 0.5 negative.
    expect(sampleLognormalDelayMs({ rng: sequence(0.999999999999, 0), ...bounds })).toBe(45_000);
    expect(sampleLognormalDelayMs({ rng: sequence(0.999999999999, 0.5), ...bounds })).toBe(1500);
  });

  it('survives a degenerate rng that returns 1', () => {
    const value = sampleLognormalDelayMs({ rng: () => 1, ...DEFAULT_VIEW_DELAY });

    expect(value).toBeGreaterThanOrEqual(DEFAULT_VIEW_DELAY.minMs);
    expect(value).toBeLessThanOrEqual(DEFAULT_VIEW_DELAY.maxMs);
  });

  it('returns the only possible value when min equals max', () => {
    expect(
      sampleLognormalDelayMs({ rng: createSeededRandom(1), medianMs: 50, minMs: 7, maxMs: 7 }),
    ).toBe(7);
  });

  describe('validation', () => {
    const rng = createSeededRandom(1);
    const valid = { rng, medianMs: 4000, minMs: 1500, maxMs: 45_000 };

    it.each([
      ['medianMs <= 0', { medianMs: 0 }],
      ['non-finite medianMs', { medianMs: Number.NaN }],
      ['negative minMs', { minMs: -1 }],
      ['maxMs below minMs', { maxMs: 1000 }],
      ['non-finite maxMs', { maxMs: Number.POSITIVE_INFINITY }],
      ['negative sigma', { sigma: -0.1 }],
      ['non-finite sigma', { sigma: Number.NaN }],
      ['a range without a whole millisecond', { minMs: 1.2, maxMs: 1.8 }],
    ])('rejects %s', (_label, override) => {
      expect(() => sampleLognormalDelayMs({ ...valid, ...override })).toThrow(ValidationError);
    });
  });
});
