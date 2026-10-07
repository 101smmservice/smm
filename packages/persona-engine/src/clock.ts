import { ValidationError } from '@persona/core';

import type { Clock } from './types.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function createClock(): Clock {
  return { now: () => new Date() };
}

export function createFixedClock(date: Date): Clock {
  assertValidDate(date, 'date');
  const fixed = date.getTime();
  return { now: () => new Date(fixed) };
}

/** Formats the UTC calendar date of `date` as `YYYY-MM-DD`. */
export function getUtcDateString(date: Date): string {
  assertValidDate(date, 'date');
  return date.toISOString().slice(0, 10);
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Parses a strict `YYYY-MM-DD` string; rejects other formats and non-existent dates. */
export function parseDateString(date: string): CalendarDate {
  const match = typeof date === 'string' ? DATE_PATTERN.exec(date) : null;
  if (match === null) {
    throw new ValidationError('date must be in YYYY-MM-DD format', 'date');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new ValidationError(`date does not exist: ${date}`, 'date');
  }

  return { year, month, day };
}

export function assertDateString(date: string): void {
  parseDateString(date);
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError(`${field} must be a valid Date`, field);
  }
}
