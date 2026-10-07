import { DomainError, type Platform } from '@persona/core';

import type { IntakeStatus } from './domain/intake-status.js';

export class IntakeError extends DomainError {
  constructor(message: string, code = 'INTAKE_ERROR', options?: ErrorOptions) {
    super(message, code, options);
    this.name = 'IntakeError';
  }
}

export class IntakeNotFoundError extends IntakeError {
  readonly requestId: string;

  constructor(requestId: string) {
    super(`Intake request not found: ${requestId}`, 'INTAKE_NOT_FOUND');
    this.name = 'IntakeNotFoundError';
    this.requestId = requestId;
  }
}

export class InvalidIntakeTransitionError extends IntakeError {
  readonly from: IntakeStatus;
  readonly to: IntakeStatus;

  constructor(from: IntakeStatus, to: IntakeStatus) {
    super(`Invalid intake transition: ${from} -> ${to}`, 'INVALID_INTAKE_TRANSITION');
    this.name = 'InvalidIntakeTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class IntakeValidationError extends IntakeError {
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message, 'INTAKE_VALIDATION_FAILED');
    this.name = 'IntakeValidationError';
    this.field = field;
  }
}

/** A completed intake request already exists for the same external account. */
export class DuplicateIntakeError extends IntakeError {
  readonly platform: Platform;
  readonly externalAccountId: string;
  readonly existingRequestId: string;

  constructor(platform: Platform, externalAccountId: string, existingRequestId: string) {
    super(
      `An intake request for ${platform} account ${externalAccountId} is already completed ` +
        `(request ${existingRequestId})`,
      'DUPLICATE_INTAKE',
    );
    this.name = 'DuplicateIntakeError';
    this.platform = platform;
    this.externalAccountId = externalAccountId;
    this.existingRequestId = existingRequestId;
  }
}
