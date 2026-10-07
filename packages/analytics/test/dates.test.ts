import { ValidationError } from '@persona/core';
import { describe, expect, it } from 'vitest';

import {
  assertDateString,
  getUtcDateString,
  isValidDateString,
  isWithinRange,
  toIsoTimestamp,
  toUtcDateString,
} from '../src/index.js';

describe('isValidDateString', () => {
  it.each(['2026-07-01', '2028-02-29', '1999-12-31', '2026-01-01'])('accepts %s', (value) => {
    expect(isValidDateString(value)).toBe(true);
  });

  it.each([
    '2026-7-1',
    '2026/07/01',
    '20260701',
    '2026-07-01T00:00:00Z',
    ' 2026-07-01',
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '',
    'today',
  ])('rejects %j', (value) => {
    expect(isValidDateString(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidDateString(20260701 as unknown as string)).toBe(false);
    expect(isValidDateString(null as unknown as string)).toBe(false);
  });
});

describe('assertDateString', () => {
  it('accepts a valid date', () => {
    expect(() => {
      assertDateString('2026-07-01');
    }).not.toThrow();
  });

  it('throws a ValidationError for an invalid date', () => {
    expect(() => {
      assertDateString('2026-02-30');
    }).toThrow(ValidationError);
  });
});

describe('getUtcDateString', () => {
  it('formats the UTC date', () => {
    expect(getUtcDateString(new Date('2026-07-01T23:59:59.999Z'))).toBe('2026-07-01');
    expect(getUtcDateString(new Date('2026-07-02T00:00:00.000Z'))).toBe('2026-07-02');
  });

  it('throws a ValidationError for an invalid Date', () => {
    expect(() => getUtcDateString(new Date('nope'))).toThrow(ValidationError);
  });
});

describe('toIsoTimestamp', () => {
  it('formats a Date as ISO 8601', () => {
    expect(toIsoTimestamp(new Date('2026-07-01T10:00:00Z'))).toBe('2026-07-01T10:00:00.000Z');
  });

  it('throws a ValidationError for an invalid Date', () => {
    expect(() => toIsoTimestamp(new Date('nope'))).toThrow(ValidationError);
  });
});

describe('toUtcDateString', () => {
  it('returns the UTC date of a timestamp in any offset', () => {
    expect(toUtcDateString('2026-07-01T10:00:00.000Z')).toBe('2026-07-01');
    expect(toUtcDateString('2026-07-01T23:30:00-05:00')).toBe('2026-07-02');
    expect(toUtcDateString('2026-07-02T01:00:00+03:00')).toBe('2026-07-01');
  });

  it.each(['', 'yesterday', 'not a date'])('throws a ValidationError for %j', (value) => {
    expect(() => toUtcDateString(value)).toThrow(ValidationError);
  });
});

describe('isWithinRange', () => {
  const range = { startDate: '2026-07-01', endDate: '2026-07-31' };

  it('returns true without a range', () => {
    expect(isWithinRange('2026-07-15')).toBe(true);
    expect(isWithinRange('1999-01-01', undefined)).toBe(true);
  });

  it('includes both bounds', () => {
    expect(isWithinRange('2026-07-01', range)).toBe(true);
    expect(isWithinRange('2026-07-31', range)).toBe(true);
    expect(isWithinRange('2026-07-15', range)).toBe(true);
  });

  it('excludes dates outside the range', () => {
    expect(isWithinRange('2026-06-30', range)).toBe(false);
    expect(isWithinRange('2026-08-01', range)).toBe(false);
  });

  it('accepts a single-day range', () => {
    const day = { startDate: '2026-07-10', endDate: '2026-07-10' };

    expect(isWithinRange('2026-07-10', day)).toBe(true);
    expect(isWithinRange('2026-07-11', day)).toBe(false);
  });

  it('matches nothing for a reversed range', () => {
    const reversed = { startDate: '2026-07-31', endDate: '2026-07-01' };

    expect(isWithinRange('2026-07-15', reversed)).toBe(false);
  });

  it('throws a ValidationError for an invalid date or range', () => {
    expect(() => isWithinRange('15.07.2026', range)).toThrow(ValidationError);
    expect(() => isWithinRange('2026-07-15', { startDate: 'x', endDate: '2026-07-31' })).toThrow(
      ValidationError,
    );
    expect(() =>
      isWithinRange('2026-07-15', { startDate: '2026-07-01', endDate: '2026-02-30' }),
    ).toThrow(ValidationError);
  });
});
