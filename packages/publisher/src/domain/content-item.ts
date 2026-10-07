import { ValidationError } from '@persona/core';

import { isContentFormat, type ContentFormat } from './content-format.js';
import type { ContentStatus } from './content-status.js';

export interface ContentItem {
  id: string;
  accountId: string;
  personaId: string | null;
  format: ContentFormat;
  title: string | null;
  brief: string | null;
  caption: string | null;
  mediaRefs: string[];
  topics: string[];
  cta: string | null;
  status: ContentStatus;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  /** YYYY-MM-DD */
  plannedDate: string | null;
  /** ISO 8601 */
  scheduledAt: string | null;
  /** ISO 8601 */
  publishedAt: string | null;
  externalId: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateContentItemDraftInput {
  id: string;
  accountId: string;
  personaId?: string | null;
  format: ContentFormat;
  title?: string | null;
  brief?: string | null;
  caption?: string | null;
  mediaRefs?: string[];
  topics?: string[];
  cta?: string | null;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** True for a real calendar date written strictly as `YYYY-MM-DD`. */
export function isValidDateString(value: unknown): value is string {
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

/**
 * True for an ISO 8601 date-time that carries an explicit UTC offset (`Z` or `+hh:mm`), e.g.
 * `2026-07-01T09:30:00.000Z`. A timestamp without an offset is ambiguous and is rejected.
 */
export function isValidIsoTimestamp(value: unknown): value is string {
  const match = typeof value === 'string' ? TIMESTAMP_PATTERN.exec(value) : null;
  if (match === null || typeof value !== 'string') {
    return false;
  }

  const [, date = '', hours = '', minutes = '', seconds = '0'] = match;
  return (
    isValidDateString(date) &&
    Number(hours) <= 23 &&
    Number(minutes) <= 59 &&
    Number(seconds) <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Creates a new item in the `draft` status. Input collections are copied, never shared. */
export function createContentItemDraft(input: CreateContentItemDraftInput): ContentItem {
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new ValidationError('id must be a non-empty string', 'id');
  }
  if (typeof input.accountId !== 'string' || input.accountId.trim() === '') {
    throw new ValidationError('accountId must be a non-empty string', 'accountId');
  }
  if (!isContentFormat(input.format)) {
    throw new ValidationError(`unknown content format: ${JSON.stringify(input.format)}`, 'format');
  }

  const createdAtDate = input.createdAt ?? new Date();
  if (!(createdAtDate instanceof Date) || Number.isNaN(createdAtDate.getTime())) {
    throw new ValidationError('createdAt must be a valid Date', 'createdAt');
  }
  const createdAt = createdAtDate.toISOString();

  return {
    id: input.id,
    accountId: input.accountId,
    personaId: input.personaId ?? null,
    format: input.format,
    title: input.title ?? null,
    brief: input.brief ?? null,
    caption: input.caption ?? null,
    mediaRefs: [...(input.mediaRefs ?? [])],
    topics: [...(input.topics ?? [])],
    cta: input.cta ?? null,
    status: 'draft',
    createdAt,
    updatedAt: createdAt,
    plannedDate: null,
    scheduledAt: null,
    publishedAt: null,
    externalId: null,
    failureReason: null,
    metadata: { ...input.metadata },
  };
}
