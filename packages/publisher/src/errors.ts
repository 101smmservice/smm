import { DomainError } from '@persona/core';

import type { ContentStatus } from './domain/content-status.js';
import type { ContentIssue } from './validation/content-readiness.js';

export class PublisherError extends DomainError {
  constructor(message: string, code = 'PUBLISHER_ERROR', options?: ErrorOptions) {
    super(message, code, options);
    this.name = 'PublisherError';
  }
}

export class ContentNotFoundError extends PublisherError {
  readonly contentId: string;

  constructor(contentId: string) {
    super(`Content item not found: ${contentId}`, 'CONTENT_NOT_FOUND');
    this.name = 'ContentNotFoundError';
    this.contentId = contentId;
  }
}

/** A content operation was rejected; `issues` lists every problem that was found. */
export class ContentValidationError extends PublisherError {
  readonly issues: readonly ContentIssue[];

  constructor(
    issues: readonly ContentIssue[],
    message?: string,
    code = 'CONTENT_VALIDATION_FAILED',
  ) {
    super(message ?? describeIssues(issues), code);
    this.name = 'ContentValidationError';
    this.issues = [...issues];
  }
}

/** A disallowed status change. It is a kind of validation failure, so it carries `issues` too. */
export class InvalidContentTransitionError extends ContentValidationError {
  readonly from: ContentStatus;
  readonly to: ContentStatus;

  constructor(from: ContentStatus, to: ContentStatus) {
    super(
      [{ code: 'invalid_transition', message: 'Transition is not allowed' }],
      `Invalid content transition: ${from} -> ${to}`,
      'INVALID_CONTENT_TRANSITION',
    );
    this.name = 'InvalidContentTransitionError';
    this.from = from;
    this.to = to;
  }
}

function describeIssues(issues: readonly ContentIssue[]): string {
  const details = issues.map((issue) => `${issue.code}: ${issue.message}`).join('; ');
  return `Content validation failed: ${details}`;
}
