import { ValidationError } from '@persona/core';

/** Returns a number in the range [0, 1), like `Math.random`. */
export type RandomFn = () => number;

export function defaultRandom(): RandomFn {
  return () => Math.random();
}

/** Deterministic PRNG (mulberry32): the same seed always yields the same sequence. */
export function createSeededRandom(seed: number): RandomFn {
  if (!Number.isFinite(seed)) {
    throw new ValidationError('seed must be a finite number', 'seed');
  }

  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
