import { isValidDateString } from '@persona/analytics';
import { isValidIsoTimestamp } from '@persona/publisher';
import { z, ZodError } from 'zod';

import { RequestValidationError } from '../errors.js';

/** A real calendar date written strictly as `YYYY-MM-DD`. */
export const dateString = z.string().refine(isValidDateString, {
  message: 'must be a real date in YYYY-MM-DD format',
});

/** An ISO 8601 date-time with an explicit UTC offset, e.g. `2026-07-01T09:30:00Z`. */
export const isoTimestamp = z.string().refine((value) => isValidIsoTimestamp(value), {
  message: 'must be an ISO 8601 timestamp with a UTC offset (Z or +hh:mm)',
});

export const idString = z.string().min(1, 'must not be empty');

export const nonEmptyText = z.string().trim().min(1, 'must not be empty');

export const metadataSchema = z.record(z.string(), z.unknown());

/** Rejects a date range whose start is after its end. */
export function hasOrderedDateRange(range: { startDate?: string; endDate?: string }): boolean {
  return (
    range.startDate === undefined || range.endDate === undefined || range.startDate <= range.endDate
  );
}

export const DATE_RANGE_ORDER_MESSAGE = 'startDate must not be after endDate';

export type RequestPart = 'body' | 'query' | 'params';

/**
 * Validates one part of a request. A failure becomes a `RequestValidationError` (HTTP 400) whose
 * details point at the offending field, e.g. `body.activityWindow.startHour`.
 */
export function parseRequest<T>(part: RequestPart, schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new RequestValidationError(
        `Invalid ${part}`,
        error.issues.map((issue) => ({
          path: [part, ...issue.path.map(String)],
          message: issue.message,
          code: issue.code,
        })),
      );
    }
    throw error;
  }
}
