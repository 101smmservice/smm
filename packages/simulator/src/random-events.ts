import { ValidationError } from '@persona/core';

/** Returns a number in the range [0, 1), like `Math.random`. */
type Random = () => number;

/**
 * Whether an event with the given `probability` (0 to 1) occurs. The random number is drawn even
 * for 0 and 1, so changing a probability never shifts the numbers the other draws receive.
 */
export function shouldOccur(probability: number, rng: Random): boolean {
  if (
    typeof probability !== 'number' ||
    Number.isNaN(probability) ||
    probability < 0 ||
    probability > 1
  ) {
    throw new ValidationError('probability must be a number from 0 to 1', 'probability');
  }
  return rng() < probability;
}

/** A random element of `items`, or `null` when there is none. */
export function pickRandom<T>(items: readonly T[], rng: Random): T | null {
  const draw = rng();
  if (items.length === 0) {
    return null;
  }
  return items[Math.min(items.length - 1, Math.floor(draw * items.length))] ?? null;
}

/** A random whole number from `min` to `max`, both included. */
export function randomInt(min: number, max: number, rng: Random): number {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new ValidationError('min and max must be integers', 'min');
  }
  if (min > max) {
    throw new ValidationError('min must not be greater than max', 'min');
  }
  return Math.min(max, min + Math.floor(rng() * (max - min + 1)));
}
