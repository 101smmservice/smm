import { ValidationError } from '@persona/core';

import {
  isValidDateString,
  isValidIsoTimestamp,
  type ContentItem,
} from '../domain/content-item.js';
import { isContentStatus, type ContentStatus } from '../domain/content-status.js';
import { InvalidContentTransitionError } from '../errors.js';

/**
 * Allowed content status transitions. Every transition that is not listed here is forbidden.
 *
 * `scheduled -> published` records that a publication was confirmed; nothing in this package
 * performs the publication itself (see {@link requiresManualConfirmation}).
 */
export const ALLOWED_CONTENT_TRANSITIONS: Readonly<
  Record<ContentStatus, readonly ContentStatus[]>
> = Object.freeze({
  draft: Object.freeze<ContentStatus[]>(['brief_ready', 'rejected', 'archived']),
  brief_ready: Object.freeze<ContentStatus[]>(['planned', 'draft', 'rejected', 'archived']),
  planned: Object.freeze<ContentStatus[]>(['ready', 'brief_ready', 'rejected', 'archived']),
  ready: Object.freeze<ContentStatus[]>(['scheduled', 'planned', 'rejected', 'archived']),
  scheduled: Object.freeze<ContentStatus[]>(['published', 'failed', 'ready']),
  failed: Object.freeze<ContentStatus[]>(['planned', 'rejected', 'archived']),
  published: Object.freeze<ContentStatus[]>(['archived']),
  rejected: Object.freeze<ContentStatus[]>(['draft']),
  archived: Object.freeze<ContentStatus[]>([]),
});

export interface TransitionContentItemOptions {
  /** The moment of the change. Defaults to the current time. */
  at?: Date;
  /** Applied when moving to `planned`. */
  plannedDate?: string;
  /** Applied when moving to `scheduled`. */
  scheduledAt?: string;
  /** Applied when moving to `published`. Defaults to the moment of the change. */
  publishedAt?: string;
  /** Applied when moving to `published`. */
  externalId?: string;
  /** Applied when moving to `failed`. */
  failureReason?: string;
}

export function canTransitionContent(from: ContentStatus, to: ContentStatus): boolean {
  if (!isContentStatus(from) || !isContentStatus(to)) {
    return false;
  }
  return ALLOWED_CONTENT_TRANSITIONS[from].includes(to);
}

export function assertContentTransition(from: ContentStatus, to: ContentStatus): void {
  if (!canTransitionContent(from, to)) {
    throw new InvalidContentTransitionError(from, to);
  }
}

/**
 * Whether the transition records something that happened outside this package and therefore has to
 * be confirmed by a person or another system. This package never publishes content itself:
 * moving to `published` only acknowledges that a publication took place.
 */
export function requiresManualConfirmation(from: ContentStatus, to: ContentStatus): boolean {
  return from === 'scheduled' && to === 'published';
}

/**
 * Returns a copy of `item` moved to status `to`; the original is never mutated.
 *
 * Each option is applied only for the status it belongs to (see {@link TransitionContentItemOptions});
 * any field that is not given keeps its current value.
 */
export function transitionContentItem(
  item: ContentItem,
  to: ContentStatus,
  options: TransitionContentItemOptions = {},
): ContentItem {
  assertContentTransition(item.status, to);

  const at = options.at ?? new Date();
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new ValidationError('at must be a valid Date', 'at');
  }
  const updatedAt = at.toISOString();

  const next: ContentItem = {
    ...item,
    mediaRefs: [...item.mediaRefs],
    topics: [...item.topics],
    metadata: { ...item.metadata },
    status: to,
    updatedAt,
  };

  switch (to) {
    case 'planned':
      if (options.plannedDate !== undefined) {
        next.plannedDate = requireDate(options.plannedDate, 'plannedDate');
      }
      break;
    case 'scheduled':
      if (options.scheduledAt !== undefined) {
        next.scheduledAt = requireTimestamp(options.scheduledAt, 'scheduledAt');
      }
      break;
    case 'published':
      next.publishedAt =
        options.publishedAt === undefined
          ? updatedAt
          : requireTimestamp(options.publishedAt, 'publishedAt');
      if (options.externalId !== undefined) {
        next.externalId = requireText(options.externalId, 'externalId');
      }
      break;
    case 'failed':
      if (options.failureReason !== undefined) {
        next.failureReason = requireText(options.failureReason, 'failureReason');
      }
      break;
    default:
      break;
  }

  return next;
}

function requireDate(value: string, field: string): string {
  if (!isValidDateString(value)) {
    throw new ValidationError(`${field} must be a real date in YYYY-MM-DD format`, field);
  }
  return value;
}

function requireTimestamp(value: string, field: string): string {
  if (!isValidIsoTimestamp(value)) {
    throw new ValidationError(`${field} must be an ISO 8601 timestamp with an offset`, field);
  }
  return value;
}

function requireText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be a non-empty string`, field);
  }
  return value;
}
