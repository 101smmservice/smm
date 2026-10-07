import {
  isValidDateString,
  isValidIsoTimestamp,
  type ContentItem,
} from '../domain/content-item.js';
import { isContentFormat } from '../domain/content-format.js';
import { isContentStatus, type ContentStatus } from '../domain/content-status.js';
import { canTransitionContent } from '../state-machine/content-state-machine.js';

export interface ContentIssue {
  code: string;
  message: string;
  field?: string;
}

export interface ContentValidationResult {
  valid: boolean;
  issues: ContentIssue[];
}

export interface ValidateContentTransitionOptions {
  plannedDate?: string;
  scheduledAt?: string;
  failureReason?: string;
}

/** Checks that the stored shape of an item is sound. Reports every problem, not just the first. */
export function validateContentItem(item: ContentItem): ContentValidationResult {
  const issues: ContentIssue[] = [];

  if (isBlank(item.id)) {
    issues.push({ code: 'missing_id', message: 'id must not be empty', field: 'id' });
  }
  if (isBlank(item.accountId)) {
    issues.push({
      code: 'missing_account_id',
      message: 'accountId must not be empty',
      field: 'accountId',
    });
  }
  if (!isContentFormat(item.format)) {
    issues.push({ code: 'invalid_format', message: 'format is not supported', field: 'format' });
  }
  if (!isContentStatus(item.status)) {
    issues.push({ code: 'invalid_status', message: 'status is not supported', field: 'status' });
  }

  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (!isValidIsoTimestamp(item[field])) {
      issues.push(invalidTimestamp(field));
    }
  }
  if (item.plannedDate !== null && !isValidDateString(item.plannedDate)) {
    issues.push(invalidPlannedDate());
  }
  if (item.scheduledAt !== null && !isValidIsoTimestamp(item.scheduledAt)) {
    issues.push({
      code: 'invalid_scheduled_at',
      message: 'scheduledAt must be an ISO 8601 timestamp with an offset',
      field: 'scheduledAt',
    });
  }
  if (item.publishedAt !== null && !isValidIsoTimestamp(item.publishedAt)) {
    issues.push(invalidTimestamp('publishedAt'));
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Checks whether `item` may move to `to`, given the values that would be supplied with the change.
 * A value that is not passed in `options` falls back to the one already stored on the item.
 *
 * `scheduled -> published` needs nothing extra: it only confirms a publication, and the external
 * identifier is optional.
 */
export function validateContentTransition(
  item: ContentItem,
  to: ContentStatus,
  options: ValidateContentTransitionOptions = {},
): ContentValidationResult {
  if (!canTransitionContent(item.status, to)) {
    return {
      valid: false,
      issues: [{ code: 'invalid_transition', message: 'Transition is not allowed' }],
    };
  }

  const issues: ContentIssue[] = [];

  if (item.status === 'draft' && to === 'brief_ready') {
    if (isBlank(item.brief)) {
      issues.push({ code: 'missing_brief', message: 'brief must not be empty', field: 'brief' });
    }
    if (!item.topics.some((topic) => !isBlank(topic))) {
      issues.push({
        code: 'missing_topics',
        message: 'at least one non-empty topic is required',
        field: 'topics',
      });
    }
  }

  if (item.status === 'brief_ready' && to === 'planned') {
    const plannedDate = options.plannedDate ?? item.plannedDate;
    if (isBlank(plannedDate)) {
      issues.push({
        code: 'missing_planned_date',
        message: 'plannedDate is required',
        field: 'plannedDate',
      });
    } else if (!isValidDateString(plannedDate)) {
      issues.push(invalidPlannedDate());
    }
  }

  if (item.status === 'planned' && to === 'ready') {
    const hasCaption = !isBlank(item.caption);
    const hasMedia = item.mediaRefs.some((ref) => !isBlank(ref));
    if (!hasCaption && !hasMedia) {
      issues.push({
        code: 'missing_content_asset',
        message: 'a caption or at least one media reference is required',
      });
    }
  }

  if (item.status === 'ready' && to === 'scheduled') {
    const scheduledAt = options.scheduledAt ?? item.scheduledAt;
    if (isBlank(scheduledAt)) {
      issues.push({
        code: 'missing_scheduled_at',
        message: 'scheduledAt is required',
        field: 'scheduledAt',
      });
    } else if (!isValidIsoTimestamp(scheduledAt)) {
      issues.push({
        code: 'invalid_scheduled_at',
        message: 'scheduledAt must be an ISO 8601 timestamp with an offset',
        field: 'scheduledAt',
      });
    }
  }

  if (item.status === 'scheduled' && to === 'failed') {
    const failureReason = options.failureReason ?? item.failureReason;
    if (isBlank(failureReason)) {
      issues.push({
        code: 'missing_failure_reason',
        message: 'failureReason is required',
        field: 'failureReason',
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

function isBlank(value: string | null | undefined): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

function invalidTimestamp(field: string): ContentIssue {
  return {
    code: 'invalid_iso_timestamp',
    message: `${field} must be an ISO 8601 timestamp with an offset`,
    field,
  };
}

function invalidPlannedDate(): ContentIssue {
  return {
    code: 'invalid_planned_date',
    message: 'plannedDate must be a real date in YYYY-MM-DD format',
    field: 'plannedDate',
  };
}
