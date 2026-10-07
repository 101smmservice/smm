import { ValidationError } from '@persona/core';

import type { DateRange } from './types.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written strictly as `YYYY-MM-DD`. */
export function isValidDateString(value: string): boolean {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function assertDateString(value: string): void {
  if (!isValidDateString(value)) {
    throw new ValidationError(
      `date must be a real date in YYYY-MM-DD format: ${JSON.stringify(value)}`,
      'date',
    );
  }
}

/** Validates both bounds of a range. A missing range is valid. */
export function assertDateRange(range?: DateRange): void {
  if (range === undefined) {
    return;
  }
  assertDateString(range.startDate);
  assertDateString(range.endDate);
}

/** Formats the UTC calendar date of `date` as `YYYY-MM-DD`. */
export function getUtcDateString(date: Date): string {
  return toIsoTimestamp(date).slice(0, 10);
}

/** `date.toISOString()` that reports an invalid `Date` as a `ValidationError`. */
export function toIsoTimestamp(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new ValidationError('date must be a valid Date', 'date');
  }
  return date.toISOString();
}

/** UTC calendar date (`YYYY-MM-DD`) of an ISO 8601 timestamp, in whatever offset it is written. */
export function toUtcDateString(timestamp: string): string {
  const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  if (Number.isNaN(parsed)) {
    throw new ValidationError(
      `not a valid ISO 8601 timestamp: ${JSON.stringify(timestamp)}`,
      'timestamp',
    );
  }
  return getUtcDateString(new Date(parsed));
}

/** Inclusive on both ends. Without a range every date matches; a reversed range matches nothing. */
export function isWithinRange(date: string, range?: DateRange): boolean {
  assertDateString(date);
  if (range === undefined) {
    return true;
  }
  assertDateRange(range);
  // Valid `YYYY-MM-DD` strings sort chronologically.
  return date >= range.startDate && date <= range.endDate;
}

export function compareDateStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}
