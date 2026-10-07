import type { AccountStatus } from '../domain/account.js';

export class DomainError extends Error {
  readonly code: string;

  constructor(message: string, code = 'DOMAIN_ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = 'DomainError';
    this.code = code;
  }
}

export class InvalidStateTransitionError extends DomainError {
  readonly from: AccountStatus;
  readonly to: AccountStatus;

  constructor(from: AccountStatus, to: AccountStatus) {
    super(`Invalid account state transition: ${from} -> ${to}`, 'INVALID_STATE_TRANSITION');
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class ValidationError extends DomainError {
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
  }
}
