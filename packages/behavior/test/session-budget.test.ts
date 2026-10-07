import { ACTION_TYPES, ValidationError } from '@persona/core';
import { describe, expect, it } from 'vitest';

import { allocateSessionBudgets } from '../src/index.js';

const ZERO = { view: 0, like: 0, follow: 0, post: 0, comment: 0 };

describe('allocateSessionBudgets', () => {
  it('splits a budget evenly when it divides without remainder', () => {
    const daily = { view: 100, like: 4 };

    expect(allocateSessionBudgets(daily, 0, 4)).toEqual({ ...ZERO, view: 25, like: 1 });
    expect(allocateSessionBudgets(daily, 3, 4)).toEqual({ ...ZERO, view: 25, like: 1 });
  });

  it('gives the remainder to the first sessions', () => {
    const daily = { like: 5 };

    expect(allocateSessionBudgets(daily, 0, 2).like).toBe(3);
    expect(allocateSessionBudgets(daily, 1, 2).like).toBe(2);
  });

  it('spreads a remainder larger than one over several leading sessions', () => {
    const shares = [0, 1, 2, 3].map((index) => allocateSessionBudgets({ view: 10 }, index, 4).view);

    expect(shares).toEqual([3, 3, 2, 2]);
  });

  it('never allocates more than the daily budget in total and loses nothing', () => {
    for (const total of [0, 1, 2, 5, 7, 8, 25, 100, 101]) {
      for (const sessionCount of [1, 2, 3, 4, 7]) {
        const shares = Array.from({ length: sessionCount }, (_, index) =>
          allocateSessionBudgets({ like: total }, index, sessionCount),
        );

        expect(shares.reduce((sum, share) => sum + share.like, 0)).toBe(total);
        for (const share of shares) {
          expect(Number.isInteger(share.like)).toBe(true);
          expect(share.like).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('returns a full record for every action type', () => {
    const result = allocateSessionBudgets({ view: 6, comment: 3 }, 1, 3);

    expect(Object.keys(result).sort()).toEqual([...ACTION_TYPES].sort());
    expect(result).toEqual({ ...ZERO, view: 2, comment: 1 });
  });

  it('gives zero sessions budgets for a zero daily budget', () => {
    for (let index = 0; index < 3; index += 1) {
      expect(allocateSessionBudgets({ view: 0, like: 0 }, index, 3)).toEqual(ZERO);
    }
    expect(allocateSessionBudgets({}, 0, 3)).toEqual(ZERO);
  });

  it('ignores keys that are not action types', () => {
    expect(allocateSessionBudgets({ view: 2, share: 9 }, 0, 1)).toEqual({ ...ZERO, view: 2 });
  });

  it.each([0, -1, -10])('returns zero budgets for sessionCount %i', (sessionCount) => {
    expect(allocateSessionBudgets({ view: 10, like: 5 }, 0, sessionCount)).toEqual(ZERO);
  });

  it.each([
    [-1, 2],
    [2, 2],
    [5, 2],
    [0.5, 2],
    [Number.NaN, 2],
  ])('throws a ValidationError for sessionIndex %f of %i sessions', (index, count) => {
    expect(() => allocateSessionBudgets({ view: 10 }, index, count)).toThrow(ValidationError);
  });

  it('throws a ValidationError for a fractional or non-finite sessionCount', () => {
    expect(() => allocateSessionBudgets({ view: 10 }, 0, 1.5)).toThrow(ValidationError);
    expect(() => allocateSessionBudgets({ view: 10 }, 0, Number.NaN)).toThrow(ValidationError);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws a ValidationError for the daily budget %f',
    (value) => {
      for (const action of ACTION_TYPES) {
        expect(() => allocateSessionBudgets({ [action]: value }, 0, 2)).toThrow(ValidationError);
      }
    },
  );
});
