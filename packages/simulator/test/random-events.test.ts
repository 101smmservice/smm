import { ValidationError } from '@persona/core';
import { describe, expect, it } from 'vitest';

import { pickRandom, randomInt, shouldOccur } from '../src/index.js';

function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe('shouldOccur', () => {
  it('never occurs at probability 0, whatever the draw', () => {
    for (const draw of [0, 0.25, 0.999999]) {
      expect(shouldOccur(0, () => draw)).toBe(false);
    }
  });

  it('always occurs at probability 1, whatever the draw', () => {
    for (const draw of [0, 0.25, 0.999999]) {
      expect(shouldOccur(1, () => draw)).toBe(true);
    }
  });

  it('occurs when the draw is below the probability', () => {
    expect(shouldOccur(0.3, () => 0.29)).toBe(true);
    expect(shouldOccur(0.3, () => 0.3)).toBe(false);
    expect(shouldOccur(0.3, () => 0.31)).toBe(false);
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws a validation error for the probability %s',
    (probability) => {
      expect(() => shouldOccur(probability, () => 0.5)).toThrow(ValidationError);
    },
  );

  it('draws once even at 0 and 1, so other draws are not shifted', () => {
    const draws: number[] = [];
    const rng = () => {
      draws.push(0.5);
      return 0.5;
    };

    shouldOccur(0, rng);
    shouldOccur(1, rng);

    expect(draws).toHaveLength(2);
  });

  it('is deterministic for the same rng', () => {
    const run = () => {
      const rng = sequence(0.1, 0.9, 0.4, 0.6);
      return [1, 2, 3, 4].map(() => shouldOccur(0.5, rng));
    };

    expect(run()).toEqual(run());
    expect(run()).toEqual([true, false, true, false]);
  });
});

describe('pickRandom', () => {
  it('returns an element of the array', () => {
    const items = ['a', 'b', 'c'] as const;

    expect(items).toContain(pickRandom(items, () => 0.5));
  });

  it('maps the draw onto the elements', () => {
    const items = ['a', 'b', 'c', 'd'] as const;

    expect(pickRandom(items, () => 0)).toBe('a');
    expect(pickRandom(items, () => 0.26)).toBe('b');
    expect(pickRandom(items, () => 0.99)).toBe('d');
  });

  it('returns null for an empty array', () => {
    expect(pickRandom([], () => 0.5)).toBeNull();
  });

  it('does not read past the end for a draw of exactly 1', () => {
    expect(pickRandom(['a', 'b'], () => 1)).toBe('b');
  });

  it('does not change the array', () => {
    const items = ['a', 'b', 'c'];

    pickRandom(items, () => 0.4);

    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic for the same rng', () => {
    const run = () => {
      const rng = sequence(0.05, 0.5, 0.95);
      return [1, 2, 3].map(() => pickRandom(['x', 'y', 'z'], rng));
    };

    expect(run()).toEqual(run());
    expect(run()).toEqual(['x', 'y', 'z']);
  });
});

describe('randomInt', () => {
  it('returns a whole number within the range, both ends included', () => {
    expect(randomInt(3, 7, () => 0)).toBe(3);
    expect(randomInt(3, 7, () => 0.999999)).toBe(7);
    for (const draw of [0.1, 0.35, 0.5, 0.77]) {
      const value = randomInt(3, 7, () => draw);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it('returns the only value of a single-value range', () => {
    expect(randomInt(5, 5, () => 0.9)).toBe(5);
  });

  it('works for negative ranges', () => {
    expect(randomInt(-3, -1, () => 0)).toBe(-3);
    expect(randomInt(-3, -1, () => 0.99)).toBe(-1);
  });

  it('stays within the range for a draw of exactly 1', () => {
    expect(randomInt(1, 6, () => 1)).toBe(6);
  });

  it('throws a validation error for a reversed or non-integer range', () => {
    expect(() => randomInt(5, 1, () => 0.5)).toThrow(ValidationError);
    expect(() => randomInt(1.5, 3, () => 0.5)).toThrow(ValidationError);
    expect(() => randomInt(1, 3.5, () => 0.5)).toThrow(ValidationError);
  });

  it('is deterministic for the same rng', () => {
    const run = () => {
      const rng = sequence(0.12, 0.56, 0.91);
      return [1, 2, 3].map(() => randomInt(0, 99, rng));
    };

    expect(run()).toEqual(run());
    expect(run()).toEqual([12, 56, 91]);
  });
});
