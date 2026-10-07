import { isIntakeStatus, type IntakeStatus } from '../domain/intake-status.js';
import { InvalidIntakeTransitionError } from '../errors.js';

/** Allowed intake status transitions. Every transition that is not listed here is forbidden. */
export const ALLOWED_INTAKE_TRANSITIONS: Readonly<Record<IntakeStatus, readonly IntakeStatus[]>> =
  Object.freeze({
    draft: Object.freeze<IntakeStatus[]>(['pending_review']),
    pending_review: Object.freeze<IntakeStatus[]>(['approved', 'rejected']),
    approved: Object.freeze<IntakeStatus[]>(['completed', 'rejected']),
    rejected: Object.freeze<IntakeStatus[]>(['draft']),
    completed: Object.freeze<IntakeStatus[]>([]),
  });

export function canTransitionIntake(from: IntakeStatus, to: IntakeStatus): boolean {
  if (!isIntakeStatus(from) || !isIntakeStatus(to)) {
    return false;
  }
  return ALLOWED_INTAKE_TRANSITIONS[from].includes(to);
}

export function assertIntakeTransition(from: IntakeStatus, to: IntakeStatus): void {
  if (!canTransitionIntake(from, to)) {
    throw new InvalidIntakeTransitionError(from, to);
  }
}

/**
 * Whether the person owning the account must have confirmed that ownership before the transition:
 * when the request is submitted for review, and again before the account is created.
 */
export function requiresOwnershipConfirmation(from: IntakeStatus, to: IntakeStatus): boolean {
  return (
    (from === 'draft' && to === 'pending_review') || (from === 'approved' && to === 'completed')
  );
}
