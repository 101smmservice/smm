import { type Account, type AccountStatus, isAccountStatus } from '../domain/account.js';
import { InvalidStateTransitionError, ValidationError } from '../errors/domain-errors.js';
import { ALLOWED_TRANSITIONS } from './transitions.js';

export function canTransition(from: AccountStatus, to: AccountStatus): boolean {
  if (!isAccountStatus(from) || !isAccountStatus(to)) {
    return false;
  }
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AccountStatus, to: AccountStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

/**
 * Returns a copy of `account` moved to status `to`. The original object is never mutated.
 */
export function transitionAccount(
  account: Account,
  to: AccountStatus,
  at: Date = new Date(),
): Account {
  assertTransition(account.status, to);

  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new ValidationError('at must be a valid Date', 'at');
  }

  return { ...account, status: to, statusChangedAt: at.toISOString() };
}
