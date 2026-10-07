import { ValidationError } from '@persona/core';

import type { RandomFn } from './random.js';

export interface DelayBounds {
  medianMs: number;
  minMs: number;
  maxMs: number;
}

/** Default pause after a `view`. */
export const DEFAULT_VIEW_DELAY: Readonly<DelayBounds> = {
  medianMs: 4000,
  minMs: 1500,
  maxMs: 45_000,
};

/** Default pause after a `like`, `follow`, `post` or `comment`. */
export const DEFAULT_ACTION_DELAY: Readonly<DelayBounds> = {
  medianMs: 8000,
  minMs: 2000,
  maxMs: 120_000,
};

const DEFAULT_SIGMA = 0.5;

export interface SampleLognormalDelayOptions extends DelayBounds {
  rng: RandomFn;
  /** Shape parameter of the log-normal distribution; 0 always yields the median. */
  sigma?: number;
}

/**
 * Draws a pause in whole milliseconds from a log-normal distribution with the given median,
 * clamped to `[minMs, maxMs]`. Deterministic for a deterministic `rng`.
 */
export function sampleLognormalDelayMs(options: SampleLognormalDelayOptions): number {
  const { rng, medianMs, minMs, maxMs, sigma = DEFAULT_SIGMA } = options;

  if (!Number.isFinite(medianMs) || medianMs <= 0) {
    throw new ValidationError('medianMs must be a positive finite number', 'medianMs');
  }
  if (!Number.isFinite(minMs) || minMs < 0) {
    throw new ValidationError('minMs must be a finite number >= 0', 'minMs');
  }
  if (!Number.isFinite(maxMs) || maxMs < minMs) {
    throw new ValidationError('maxMs must be a finite number >= minMs', 'maxMs');
  }
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new ValidationError('sigma must be a finite number >= 0', 'sigma');
  }

  const lower = Math.ceil(minMs);
  const upper = Math.floor(maxMs);
  if (lower > upper) {
    throw new ValidationError('no whole millisecond value between minMs and maxMs', 'maxMs');
  }

  // Box-Muller transform: two uniform draws give one standard normal value.
  const u1 = Math.max(1 - rng(), Number.EPSILON);
  const u2 = rng();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  const raw = medianMs * Math.exp(sigma * normal);
  const sample = Number.isNaN(raw) ? medianMs : raw;
  return Math.min(Math.max(Math.round(sample), lower), upper);
}
